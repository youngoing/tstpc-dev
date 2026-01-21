import { createLightweightHttpServer } from "./LightweightHttpServer"
import { LightweightServiceType } from "./LightweightTypes"

/**
 * 定义服务类型
 * 这是唯一需要预先定义的类型，无需复杂的协议文件
 */
interface MyServiceType extends LightweightServiceType {
  api: {
    // 用户相关API
    "user/login": {
      req: { username: string; password: string }
      res: { token: string; userId: string; username: string }
    }
    "user/profile": {
      req: { userId: string }
      res: { userId: string; username: string; email: string; avatar?: string }
    }
    "user/updateProfile": {
      req: { userId: string; username?: string; email?: string; avatar?: string }
      res: { success: true }
    }
    // 商品相关API
    "product/list": {
      req: { page: number; size: number; category?: string }
      res: { products: Array<{ id: string; name: string; price: number; category: string }> }
    }
    "product/detail": {
      req: { productId: string }
      res: { id: string; name: string; price: number; description: string; images: string[] }
    }
  }
  msg: {
    // 实时消息
    "chat/message": {
      userId: string
      username: string
      message: string
      timestamp: number
    }
    "user/online": {
      userId: string
      username: string
    }
    "system/notification": {
      type: "info" | "warning" | "error"
      title: string
      content: string
    }
  }
}

/**
 * 创建轻量级服务器示例
 */
async function createExampleServer() {
  // 创建服务器实例
  const server = createLightweightHttpServer<MyServiceType>({
    port: 3000,
    jsonHostPath: "/api",
    cors: "*",
    enableValidation: true,
    debug: true,
    serializationMode: "auto",
  })

  // 模拟数据库
  const users = new Map([
    ["1", { id: "1", username: "admin", email: "admin@example.com", password: "123456" }],
    ["2", { id: "2", username: "user1", email: "user1@example.com", password: "123456" }],
  ])

  const products = [
    {
      id: "1",
      name: "iPhone 15",
      price: 999,
      category: "phone",
      description: "Latest iPhone",
      images: [],
    },
    {
      id: "2",
      name: "MacBook Pro",
      price: 1999,
      category: "laptop",
      description: "Professional laptop",
      images: [],
    },
  ]

  // 设置流程中间件
  server.setFlows({
    onConnect: async (data, context, next) => {
      context.logger.log("新连接建立:", data.connId, data.clientIp)
      await next()
    },

    onDisconnect: async (data, context, next) => {
      context.logger.log("连接断开:", data.connId, data.reason)
      await next()
    },

    preApiCall: async (data, context, next) => {
      context.logger.log("API调用前置检查:", data.apiName)

      // 简单的认证检查（除了登录接口）
      if (data.apiName !== "user/login") {
        const token = context.extra?.httpReq?.headers["authorization"]
        if (!token) {
          context.logger.warn("未提供认证令牌")
          return // 不调用next()，中断执行
        }
      }

      await next()
    },

    preApiReturn: async (data, context, next) => {
      const duration = Date.now() - context.startTime
      context.logger.log(`API ${data.apiName} 执行完成，耗时: ${duration}ms`)
      await next()
    },
  })

  // 实现用户相关API
  server.implementApi("user/login", async (req, context) => {
    context.logger.log("用户登录请求:", req.username)

    // 简单的用户验证
    const user = Array.from(users.values()).find(
      u => u.username === req.username && u.password === req.password
    )

    if (!user) {
      throw new Error("用户名或密码错误")
    }

    // 生成简单的token
    const token = `token_${user.id}_${Date.now()}`

    return {
      token,
      userId: user.id,
      username: user.username,
    }
  })

  server.implementApi("user/profile", async (req, context) => {
    const user = users.get(req.userId)
    if (!user) {
      throw new Error("用户不存在")
    }

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      avatar: `https://avatar.example.com/${user.id}.jpg`,
    }
  })

  server.implementApi("user/updateProfile", async (req, context) => {
    const user = users.get(req.userId)
    if (!user) {
      throw new Error("用户不存在")
    }

    // 更新用户信息
    if (req.username) user.username = req.username
    if (req.email) user.email = req.email

    context.logger.log("用户信息已更新:", user.username)

    return { success: true }
  })

  // 实现商品相关API
  server.implementApi("product/list", async (req, context) => {
    const { page, size, category } = req
    let filteredProducts = products

    if (category) {
      filteredProducts = products.filter(p => p.category === category)
    }

    const start = (page - 1) * size
    const end = start + size
    const pageProducts = filteredProducts.slice(start, end)

    return {
      products: pageProducts.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category,
      })),
    }
  })

  server.implementApi("product/detail", async (req, context) => {
    const product = products.find(p => p.id === req.productId)
    if (!product) {
      throw new Error("商品不存在")
    }

    return {
      id: product.id,
      name: product.name,
      price: product.price,
      description: product.description,
      images: product.images,
    }
  })

  // 监听消息
  server.listenMsg("chat/message", async (msg, context) => {
    context.logger.log("收到聊天消息:", msg.username, msg.message)

    // 这里可以实现消息存储、过滤等逻辑
    // 由于是HTTP服务器，无法直接推送，但可以记录消息供后续查询
  })

  server.listenMsg("user/online", async (msg, context) => {
    context.logger.log("用户上线:", msg.username)
    // 更新用户在线状态
  })

  return server
}

/**
 * 客户端测试示例
 */
async function testClient() {
  const baseUrl = "http://localhost:3000/api"

  // 测试用户登录
  console.log("=== 测试用户登录 ===")
  const loginResponse = await fetch(`${baseUrl}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123456" }),
  })
  const loginResult = await loginResponse.json()
  console.log("登录结果:", loginResult)

  if (!loginResult.isSucc) {
    console.error("登录失败")
    return
  }

  const token = loginResult.res.token

  // 测试获取用户信息
  console.log("\n=== 测试获取用户信息 ===")
  const profileResponse = await fetch(`${baseUrl}/user/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ userId: "1" }),
  })
  const profileResult = await profileResponse.json()
  console.log("用户信息:", profileResult)

  // 测试商品列表
  console.log("\n=== 测试商品列表 ===")
  const productsResponse = await fetch(`${baseUrl}/product/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ page: 1, size: 10 }),
  })
  const productsResult = await productsResponse.json()
  console.log("商品列表:", productsResult)

  // 测试发送消息
  console.log("\n=== 测试发送消息 ===")
  const msgResponse = await fetch(`${baseUrl}/chat/message?type=msg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: "1",
      username: "admin",
      message: "Hello, World!",
      timestamp: Date.now(),
    }),
  })
  const msgResult = await msgResponse.json()
  console.log("消息发送结果:", msgResult)
}

/**
 * 性能测试示例
 */
async function performanceTest() {
  const baseUrl = "http://localhost:3000/api"
  const concurrency = 10 // 并发数
  const requestCount = 100 // 每个并发的请求数

  console.log(`\n=== 性能测试 (${concurrency}x${requestCount}请求) ===`)

  // 先登录获取token
  const loginResponse = await fetch(`${baseUrl}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123456" }),
  })
  const loginResult = await loginResponse.json()
  const token = loginResult.res.token

  const startTime = Date.now()
  const promises: Promise<any>[] = []

  // 创建并发请求
  for (let i = 0; i < concurrency; i++) {
    const promise = (async () => {
      const results = []
      for (let j = 0; j < requestCount; j++) {
        try {
          const response = await fetch(`${baseUrl}/product/list`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: token,
            },
            body: JSON.stringify({ page: 1, size: 10 }),
          })
          const result = await response.json()
          results.push(result.isSucc)
        } catch (error) {
          results.push(false)
        }
      }
      return results
    })()
    promises.push(promise)
  }

  // 等待所有请求完成
  const allResults = await Promise.all(promises)
  const endTime = Date.now()

  // 统计结果
  const totalRequests = concurrency * requestCount
  const successCount = allResults
    .reduce((acc, results) => acc.concat(results), [])
    .filter(Boolean).length
  const failureCount = totalRequests - successCount
  const duration = endTime - startTime
  const rps = Math.round((totalRequests / duration) * 1000)

  console.log(`总请求数: ${totalRequests}`)
  console.log(`成功请求: ${successCount}`)
  console.log(`失败请求: ${failureCount}`)
  console.log(`耗时: ${duration}ms`)
  console.log(`RPS: ${rps}`)
}

/**
 * 主函数
 */
async function main() {
  console.log("启动轻量级TSRPC服务器示例...\n")

  // 创建并启动服务器
  const server = await createExampleServer()

  try {
    await server.start()
    console.log("服务器启动成功!")
    console.log("协议统计:", server.getProtocolStats())
    console.log("服务器信息:", server.getServerInfo())

    // 等待一秒让服务器完全启动
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 运行客户端测试
    if (process.argv.includes("--test")) {
      await testClient()
    }

    // 运行性能测试
    if (process.argv.includes("--perf")) {
      await performanceTest()
    }

    if (!process.argv.includes("--test") && !process.argv.includes("--perf")) {
      console.log("\n服务器已启动，可以通过以下方式测试:")
      console.log("npm run example --test    # 运行功能测试")
      console.log("npm run example --perf    # 运行性能测试")
      console.log("\n或者直接访问: http://localhost:3000/api/user/login")
      console.log('POST 数据: {"username": "admin", "password": "123456"}')
    }
  } catch (error) {
    console.error("服务器启动失败:", error)
  }

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\n正在关闭服务器...")
    await server.stop()
    console.log("服务器已关闭")
    process.exit(0)
  })
}

// 如果作为主模块运行
if (require.main === module) {
  main().catch(console.error)
}

export { MyServiceType, createExampleServer, testClient, performanceTest }
