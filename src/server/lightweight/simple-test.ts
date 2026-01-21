import { createStandaloneHttpServer, StandaloneServiceType } from "./standalone"

/**
 * 测试服务类型定义
 */
interface TestService extends StandaloneServiceType {
  api: {
    "hello": {
      req: { name: string }
      res: { message: string }
    }
    "add": {
      req: { a: number; b: number }
      res: { result: number }
    }
    "error": {
      req: {}
      res: never
    }
  }
  msg: {
    "notification": {
      type: string
      message: string
    }
  }
}

/**
 * 创建测试服务器
 */
async function createTestServer() {
  const server = createStandaloneHttpServer<TestService>({
    port: 3002,
    debug: true,
  })

  // 实现API
  server.implementApi("hello", async (req, context) => {
    return { message: `Hello, ${req.name}!` }
  })

  server.implementApi("add", async (req, context) => {
    return { result: req.a + req.b }
  })

  server.implementApi("error", async (req, context) => {
    throw new Error("Test error")
  })

  // 监听消息
  server.listenMsg("notification", async (msg, context) => {
    context.logger.log("收到通知:", msg)
  })

  // 设置中间件
  server.setFlows({
    preApiCall: async (data, context, next) => {
      context.logger.log("API调用:", data.apiName)
      await next()
    },
  })

  return server
}

/**
 * 运行测试
 */
async function runTest() {
  console.log("🚀 启动独立轻量级服务器测试")

  const server = await createTestServer()

  try {
    await server.start()
    console.log("✅ 服务器启动成功!")
    console.log("📊 服务器信息:", server.getServerInfo())

    // 等待一秒
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 测试API调用
    console.log("\n🧪 测试API调用...")

    const testCases = [
      {
        name: "Hello API",
        url: "http://localhost:3002/api/hello",
        body: { name: "World" },
      },
      {
        name: "Add API",
        url: "http://localhost:3002/api/add",
        body: { a: 10, b: 20 },
      },
    ]

    for (const testCase of testCases) {
      try {
        const response = await fetch(testCase.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(testCase.body),
        })

        const result = await response.json()
        console.log(`✅ ${testCase.name}:`, result)
      } catch (error) {
        console.log(`❌ ${testCase.name} 失败:`, error)
      }
    }

    // 测试消息
    console.log("\n📨 测试消息...")
    try {
      const response = await fetch("http://localhost:3002/api/notification?type=msg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "info",
          message: "Test notification",
        }),
      })

      const result = await response.json()
      console.log("✅ 消息测试:", result)
    } catch (error) {
      console.log("❌ 消息测试失败:", error)
    }

    console.log("\n🎉 测试完成!")

  } catch (error) {
    console.error("💥 测试失败:", error)
  } finally {
    await server.stop()
    console.log("✅ 服务器已停止")
  }
}

// 运行测试
if (require.main === module) {
  runTest().catch(console.error)
}

export { TestService, createTestServer, runTest }
