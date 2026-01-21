import { createLightweightHttpServer } from "./LightweightHttpServer"
import { LightweightServiceType } from "./LightweightTypes"

/**
 * 测试服务类型定义
 */
interface TestServiceType extends LightweightServiceType {
  api: {
    "test/hello": {
      req: { name: string }
      res: { message: string; timestamp: number }
    }
    "test/echo": {
      req: { data: any }
      res: { echo: any }
    }
    "test/error": {
      req: {}
      res: never
    }
    "math/add": {
      req: { a: number; b: number }
      res: { result: number }
    }
    "auth/login": {
      req: { username: string; password: string }
      res: { token: string; userId: string }
    }
  }
  msg: {
    "test/notification": {
      type: "info" | "warning" | "error"
      message: string
      timestamp: number
    }
    "chat/message": {
      userId: string
      content: string
      timestamp: number
    }
  }
}

/**
 * 创建测试服务器
 */
function createTestServer() {
  const server = createLightweightHttpServer<TestServiceType>({
    port: 3001,
    jsonHostPath: "/api",
    cors: "*",
    enableValidation: true,
    debug: true,
    serializationMode: "auto",
  })

  // 实现测试API
  server.implementApi("test/hello", async (req, context) => {
    context.logger.log("Hello API called with:", req)
    return {
      message: `Hello, ${req.name}!`,
      timestamp: Date.now(),
    }
  })

  server.implementApi("test/echo", async (req, context) => {
    context.logger.log("Echo API called with:", req)
    return {
      echo: req.data,
    }
  })

  server.implementApi("test/error", async (req, context) => {
    context.logger.log("Error API called - will throw error")
    throw new Error("This is a test error")
  })

  server.implementApi("math/add", async (req, context) => {
    context.logger.log("Math add API called:", req)
    if (typeof req.a !== "number" || typeof req.b !== "number") {
      throw new Error("Both a and b must be numbers")
    }
    return {
      result: req.a + req.b,
    }
  })

  server.implementApi("auth/login", async (req, context) => {
    context.logger.log("Login attempt:", req.username)

    // 简单验证
    if (req.username === "admin" && req.password === "123456") {
      return {
        token: `token_${Date.now()}`,
        userId: "admin",
      }
    } else {
      throw new Error("Invalid credentials")
    }
  })

  // 监听测试消息
  server.listenMsg("test/notification", async (msg, context) => {
    context.logger.log(`Received notification [${msg.type}]:`, msg.message)
  })

  server.listenMsg("chat/message", async (msg, context) => {
    context.logger.log(`Chat message from ${msg.userId}:`, msg.content)
  })

  // 设置中间件
  server.setFlows({
    onConnect: async (data, context, next) => {
      context.logger.log("🔌 New connection:", data.connId)
      await next()
    },

    onDisconnect: async (data, context, next) => {
      context.logger.log("🔌 Connection closed:", data.connId)
      await next()
    },

    preApiCall: async (data, context, next) => {
      context.logger.log("📥 API call:", data.apiName)

      // 模拟认证检查
      if (data.apiName.startsWith("auth/")) {
        // 认证API不需要token
        await next()
        return
      }

      // 其他API需要基本验证（除了测试API）
      if (!data.apiName.startsWith("test/")) {
        const token = context.extra?.httpReq?.headers["authorization"]
        if (!token) {
          throw new Error("Authorization token required")
        }
      }

      await next()
    },

    postApiCall: async (data, context, next) => {
      const duration = Date.now() - context.startTime
      context.logger.log(`📤 API response: ${data.apiName} (${duration}ms)`)
      await next()
    },

    preMsgReceive: async (data, context, next) => {
      context.logger.log("📨 Message received:", data.msgName)
      await next()
    },
  })

  return server
}

/**
 * 运行API测试
 */
async function runApiTests() {
  const baseUrl = "http://localhost:3001/api"

  console.log("🧪 Running API Tests...")

  const tests = [
    {
      name: "Hello API",
      request: () =>
        fetch(`${baseUrl}/test/hello`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "World" }),
        }),
      expect: (result: any) => {
        return result.isSucc && result.res.message === "Hello, World!"
      },
    },
    {
      name: "Echo API",
      request: () =>
        fetch(`${baseUrl}/test/echo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { test: "echo", numbers: [1, 2, 3] } }),
        }),
      expect: (result: any) => {
        return result.isSucc && result.res.echo.test === "echo"
      },
    },
    {
      name: "Math Add API",
      request: () =>
        fetch(`${baseUrl}/math/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: 10, b: 20 }),
        }),
      expect: (result: any) => {
        return result.isSucc && result.res.result === 30
      },
    },
    {
      name: "Error API",
      request: () =>
        fetch(`${baseUrl}/test/error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      expect: (result: any) => {
        return !result.isSucc && result.err.message === "This is a test error"
      },
    },
    {
      name: "Login API - Success",
      request: () =>
        fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "123456" }),
        }),
      expect: (result: any) => {
        return result.isSucc && result.res.userId === "admin"
      },
    },
    {
      name: "Login API - Failure",
      request: () =>
        fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "wrong" }),
        }),
      expect: (result: any) => {
        return !result.isSucc && result.err.message === "Invalid credentials"
      },
    },
  ]

  let passed = 0
  let failed = 0

  for (const test of tests) {
    try {
      console.log(`\n  🔍 Testing: ${test.name}`)
      const response = await test.request()
      const result = await response.json()

      if (test.expect(result)) {
        console.log(`    ✅ PASSED`)
        passed++
      } else {
        console.log(`    ❌ FAILED - Unexpected result:`, result)
        failed++
      }
    } catch (error) {
      console.log(`    ❌ FAILED - Error:`, error)
      failed++
    }
  }

  console.log(`\n🧪 Test Results: ${passed} passed, ${failed} failed`)
  return { passed, failed }
}

/**
 * 运行消息测试
 */
async function runMessageTests() {
  const baseUrl = "http://localhost:3001/api"

  console.log("\n📨 Running Message Tests...")

  const messageTests = [
    {
      name: "Test Notification",
      request: () =>
        fetch(`${baseUrl}/test/notification?type=msg`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "info",
            message: "Test notification message",
            timestamp: Date.now(),
          }),
        }),
    },
    {
      name: "Chat Message",
      request: () =>
        fetch(`${baseUrl}/chat/message?type=msg`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: "user123",
            content: "Hello from test!",
            timestamp: Date.now(),
          }),
        }),
    },
  ]

  let passed = 0
  let failed = 0

  for (const test of messageTests) {
    try {
      console.log(`\n  📤 Testing: ${test.name}`)
      const response = await test.request()
      const result = await response.json()

      if (result.success || response.ok) {
        console.log(`    ✅ PASSED`)
        passed++
      } else {
        console.log(`    ❌ FAILED - Unexpected result:`, result)
        failed++
      }
    } catch (error) {
      console.log(`    ❌ FAILED - Error:`, error)
      failed++
    }
  }

  console.log(`\n📨 Message Test Results: ${passed} passed, ${failed} failed`)
  return { passed, failed }
}

/**
 * 性能测试
 */
async function runPerformanceTest() {
  const baseUrl = "http://localhost:3001/api"
  const concurrency = 5
  const requestCount = 20

  console.log(`\n⚡ Running Performance Test (${concurrency}x${requestCount} requests)...`)

  const startTime = Date.now()
  const promises: Promise<any>[] = []

  for (let i = 0; i < concurrency; i++) {
    const promise = (async () => {
      const results = []
      for (let j = 0; j < requestCount; j++) {
        try {
          const response = await fetch(`${baseUrl}/test/hello`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `User${i}-${j}` }),
          })
          const result = await response.json()
          results.push(result.isSucc)
        } catch {
          results.push(false)
        }
      }
      return results
    })()
    promises.push(promise)
  }

  const allResults = await Promise.all(promises)
  const endTime = Date.now()

  const totalRequests = concurrency * requestCount
  const successCount = allResults
    .reduce((acc, results) => acc.concat(results), [])
    .filter(Boolean).length
  const failureCount = totalRequests - successCount
  const duration = endTime - startTime
  const rps = Math.round((totalRequests / duration) * 1000)

  console.log(`\n⚡ Performance Results:`)
  console.log(`  Total Requests: ${totalRequests}`)
  console.log(`  Success: ${successCount}`)
  console.log(`  Failures: ${failureCount}`)
  console.log(`  Duration: ${duration}ms`)
  console.log(`  RPS: ${rps}`)

  return { totalRequests, successCount, failureCount, duration, rps }
}

/**
 * 主测试函数
 */
async function runTests() {
  console.log("🚀 Starting Lightweight TSRPC Server Tests\n")

  const server = createTestServer()

  try {
    // 启动服务器
    await server.start()
    console.log("✅ Server started successfully!")
    console.log("📊 Protocol Stats:", server.getProtocolStats())

    // 等待服务器完全启动
    await new Promise(resolve => setTimeout(resolve, 500))

    // 运行测试
    const apiResults = await runApiTests()
    const msgResults = await runMessageTests()
    const perfResults = await runPerformanceTest()

    // 显示总结
    console.log("\n" + "=".repeat(60))
    console.log("📈 Test Summary:")
    console.log(`  API Tests: ${apiResults.passed}/${apiResults.passed + apiResults.failed} passed`)
    console.log(`  Message Tests: ${msgResults.passed}/${msgResults.passed + msgResults.failed} passed`)
    console.log(`  Performance: ${perfResults.rps} RPS (${perfResults.successCount}/${perfResults.totalRequests} success)`)
    console.log("=".repeat(60))

    // 停止服务器
    await server.stop()
    console.log("✅ Server stopped successfully!")

    const totalTests = apiResults.passed + apiResults.failed + msgResults.passed + msgResults.failed
    const totalPassed = apiResults.passed + msgResults.passed
    const success = apiResults.failed === 0 && msgResults.failed === 0

    if (success) {
      console.log(`\n🎉 All tests passed! (${totalPassed}/${totalTests})`)
      process.exit(0)
    } else {
      console.log(`\n❌ Some tests failed. (${totalPassed}/${totalTests})`)
      process.exit(1)
    }
  } catch (error) {
    console.error("💥 Test failed with error:", error)
    try {
      await server.stop()
    } catch {}
    process.exit(1)
  }
}

// 运行测试（如果直接执行此文件）
if (require.main === module) {
  runTests().catch(console.error)
}

export {
  TestServiceType,
  createTestServer,
  runApiTests,
  runMessageTests,
  runPerformanceTest,
  runTests,
}
