# TSRPC 轻量级服务器

这是一个基于TSRPC架构的轻量级服务器实现，提供运行时协议生成和简化的API定义方式，避免了传统TSRPC中复杂的协议文件生成过程。

## ✨ 特性

- **🚀 零配置启动** - 无需预生成协议文件，运行时动态生成
- **💡 类型安全** - 完整的TypeScript类型推断和检查
- **🔧 简化API** - 只需定义接口类型，自动处理序列化
- **🎯 高性能** - 支持JSON和二进制两种序列化方式
- **🔌 中间件支持** - 灵活的流程控制和中间件系统
- **📊 内置验证** - 可选的运行时数据验证
- **🌐 HTTP/WebSocket** - 支持多种传输协议

## 🚀 快速开始

### 1. 定义服务类型

```typescript
import { LightweightServiceType } from './lightweight'

interface MyService extends LightweightServiceType {
  api: {
    'user/login': {
      req: { username: string; password: string }
      res: { token: string; userId: string }
    }
    'user/profile': {
      req: { userId: string }
      res: { username: string; email: string }
    }
  }
  msg: {
    'chat/message': {
      userId: string
      content: string
      timestamp: number
    }
  }
}
```

### 2. 创建服务器

```typescript
import { createLightweightHttpServer } from './lightweight'

const server = createLightweightHttpServer<MyService>({
  port: 3000,
  jsonHostPath: '/api',
  enableValidation: true,
  debug: true
})
```

### 3. 实现API处理器

```typescript
// 实现登录API
server.implementApi('user/login', async (req, context) => {
  // req 自动推断为 { username: string; password: string }
  const { username, password } = req
  
  // 验证用户...
  if (username === 'admin' && password === '123456') {
    return {
      token: 'jwt-token-here',
      userId: '1'
    }
  }
  
  throw new Error('Invalid credentials')
})

// 实现用户信息API  
server.implementApi('user/profile', async (req, context) => {
  // req 自动推断为 { userId: string }
  const user = await getUserById(req.userId)
  
  return {
    username: user.name,
    email: user.email
  }
})
```

### 4. 监听消息

```typescript
server.listenMsg('chat/message', async (msg, context) => {
  // msg 自动推断为 { userId: string; content: string; timestamp: number }
  console.log(`收到来自 ${msg.userId} 的消息: ${msg.content}`)
  
  // 处理聊天消息...
  await saveChatMessage(msg)
})
```

### 5. 设置中间件

```typescript
server.setFlows({
  // API调用前置检查
  preApiCall: async (data, context, next) => {
    // 认证检查
    if (data.apiName !== 'user/login') {
      const token = context.extra?.httpReq?.headers['authorization']
      if (!token) {
        context.logger.warn('未提供认证令牌')
        return // 不调用next()，中断执行
      }
    }
    await next()
  },
  
  // API执行完成后
  postApiCall: async (data, context, next) => {
    const duration = Date.now() - context.startTime
    context.logger.log(`API ${data.apiName} 执行完成，耗时: ${duration}ms`)
    await next()
  }
})
```

### 6. 启动服务器

```typescript
async function startServer() {
  await server.start()
  console.log('服务器启动成功!')
  console.log('协议统计:', server.getProtocolStats())
}

startServer().catch(console.error)
```

## 📖 API文档

### LightweightHttpServer

主要的HTTP服务器类，支持JSON和二进制两种数据格式。

#### 构造选项

```typescript
interface LightweightHttpServerOptions {
  port: number                    // 监听端口，默认3000
  jsonHostPath?: string          // JSON API路径前缀，默认'/api'
  cors?: string                  // CORS设置，默认'*'
  enableValidation?: boolean     // 启用运行时验证，默认true
  debug?: boolean               // 调试模式，默认false
  serializationMode?: 'json' | 'binary' | 'auto'  // 序列化模式
  maxBodySize?: number          // 请求体大小限制
  socketTimeout?: number        // Socket超时时间
}
```

#### 主要方法

```typescript
// 实现API处理器
implementApi<K>(apiName: K, handler: (req, context) => Promise<res>): void

// 监听消息
listenMsg<K>(msgName: K, handler: (msg, context) => Promise<void>): void

// 设置流程中间件
setFlows(flows: LightweightFlows): void

// 启动/停止服务器
start(): Promise<void>
stop(): Promise<void>

// 获取服务器信息
getProtocolStats(): object
getServerInfo(): object
```

### RuntimeProtocolGenerator

运行时协议生成器，负责动态生成协议信息。

```typescript
// 注册API服务
registerApi(apiName: string, validator?: object): number

// 注册消息服务  
registerMsg(msgName: string, validator?: Function): number

// 验证数据
validateRequest(apiName: string, data: any): boolean
validateResponse(apiName: string, data: any): boolean
validateMessage(msgName: string, data: any): boolean

// 序列化/反序列化
serialize(data: any, mode?: string): string | Uint8Array
deserialize(data: string | Uint8Array): any
```

## 🔧 高级用法

### 自定义验证器

```typescript
import { createRuntimeProtocol } from './lightweight'

const protocol = createRuntimeProtocol<MyService>({
  enableValidation: true,
  customValidators: {
    'user/login': {
      req: (data) => {
        return typeof data.username === 'string' && 
               typeof data.password === 'string' &&
               data.username.length > 0
      },
      res: (data) => {
        return typeof data.token === 'string' &&
               typeof data.userId === 'string'
      }
    }
  }
})
```

### 中间件系统

轻量级服务器支持完整的中间件系统：

```typescript
server.setFlows({
  // 连接相关
  onConnect: async (data, context, next) => {
    console.log('新连接:', data.connId)
    await next()
  },
  
  onDisconnect: async (data, context, next) => {
    console.log('连接断开:', data.connId)
    await next()
  },
  
  // 数据处理
  preReceiveData: async (data, context, next) => {
    // 数据解密、日志记录等
    await next()
  },
  
  preSendData: async (data, context, next) => {
    // 数据加密、压缩等
    await next()
  },
  
  // API流程
  preApiCall: async (data, context, next) => {
    // 权限检查、参数预处理等
    await next()
  },
  
  preApiReturn: async (data, context, next) => {
    // 响应数据处理
    await next()
  },
  
  postApiCall: async (data, context, next) => {
    // 日志记录、统计等
    await next()
  },
  
  // 消息流程
  preMsgReceive: async (data, context, next) => {
    // 消息预处理
    await next()
  },
  
  preMsgSend: async (data, context, next) => {
    // 消息发送预处理
    await next()
  }
})
```

### 错误处理

```typescript
server.implementApi('user/login', async (req, context) => {
  try {
    // 业务逻辑
    const user = await authenticateUser(req.username, req.password)
    return { token: generateToken(user), userId: user.id }
    
  } catch (error) {
    // 可以抛出不同类型的错误
    if (error instanceof ValidationError) {
      throw new Error('参数验证失败')
    } else if (error instanceof AuthenticationError) {
      throw new Error('认证失败')
    } else {
      context.logger.error('登录过程中发生错误:', error)
      throw new Error('服务器内部错误')
    }
  }
})
```

## 🌐 客户端调用

### JSON格式调用

```typescript
// 调用API
const response = await fetch('http://localhost:3000/api/user/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '123456' })
})

const result = await response.json()
if (result.isSucc) {
  console.log('登录成功:', result.res)
} else {
  console.error('登录失败:', result.err)
}

// 发送消息
await fetch('http://localhost:3000/api/chat/message?type=msg', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: '1',
    content: 'Hello, World!',
    timestamp: Date.now()
  })
})
```

### 二进制格式调用

```typescript
// 使用二进制格式可以获得更好的性能
const binaryData = server.protocolGenerator.serialize({
  type: 'api',
  serviceName: 'user/login',
  data: { username: 'admin', password: '123456' }
})

const response = await fetch('http://localhost:3000/api/user/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: binaryData
})

const result = server.protocolGenerator.deserialize(
  new Uint8Array(await response.arrayBuffer())
)
```

## 📊 性能优化

### 序列化模式选择

```typescript
const server = createLightweightHttpServer<MyService>({
  serializationMode: 'auto',  // 自动选择最优序列化方式
  // 或者手动指定
  // serializationMode: 'json'    // 小数据量，易调试
  // serializationMode: 'binary'  // 大数据量，高性能
})
```

### 验证模式配置

```typescript
const server = createLightweightHttpServer<MyService>({
  enableValidation: process.env.NODE_ENV === 'development',  // 开发环境启用验证
  debug: process.env.NODE_ENV === 'development'              // 开发环境启用调试
})
```

## 🔄 与传统TSRPC的对比

| 特性 | 传统TSRPC | 轻量级TSRPC |
|------|----------|------------|
| 协议文件 | 需要预生成大量Schema | 运行时动态生成 |
| 启动时间 | 慢（需加载大协议文件） | 快（按需生成） |
| 内存占用 | 高（完整Schema缓存） | 低（最小化信息） |
| 开发体验 | 需要代码生成步骤 | 零配置启动 |
| 类型安全 | 完美 | 完美 |
| 性能 | 非常高 | 高 |
| 灵活性 | 中等 | 很高 |
| 学习成本 | 高 | 低 |

## 🚀 最佳实践

### 1. 项目结构建议

```
src/
├── types/
│   └── service.ts        # 服务类型定义
├── handlers/
│   ├── user.ts          # 用户相关API实现
│   └── product.ts       # 商品相关API实现
├── middleware/
│   ├── auth.ts          # 认证中间件
│   └── logger.ts        # 日志中间件
└── server.ts            # 服务器启动文件
```

### 2. 类型定义最佳实践

```typescript
// types/service.ts
export interface AppService extends LightweightServiceType {
  api: {
    // 按模块组织API
    'auth/login': { req: LoginReq; res: LoginRes }
    'auth/logout': { req: LogoutReq; res: LogoutRes }
    'user/profile': { req: ProfileReq; res: ProfileRes }
    'user/update': { req: UpdateReq; res: UpdateRes }
  }
  msg: {
    // 按功能组织消息
    'chat/message': ChatMessage
    'system/notification': SystemNotification
  }
}

// 单独定义复杂类型
export interface LoginReq {
  username: string
  password: string
  captcha?: string
}

export interface LoginRes {
  token: string
  userId: string
  permissions: string[]
}
```

### 3. 处理器组织

```typescript
// handlers/user.ts
import { AppService } from '../types/service'
import { LightweightApiHandler } from '../lightweight'

export const loginHandler: LightweightApiHandler<
  AppService['api']['auth/login']['req'],
  AppService['api']['auth/login']['res']
> = async (req, context) => {
  // 实现登录逻辑
}

export const profileHandler: LightweightApiHandler<
  AppService['api']['user/profile']['req'], 
  AppService['api']['user/profile']['res']
> = async (req, context) => {
  // 实现获取用户信息逻辑
}
```

### 4. 中间件模块化

```typescript
// middleware/auth.ts
import { LightweightMiddleware } from '../lightweight'

export const authMiddleware: LightweightMiddleware = async (data, context, next) => {
  if (data.apiName?.startsWith('auth/')) {
    // 认证相关API跳过检查
    return await next()
  }
  
  const token = context.extra?.httpReq?.headers['authorization']
  if (!token || !isValidToken(token)) {
    throw new Error('Authentication required')
  }
  
  await next()
}
```

## ❓ 常见问题

### Q: 如何迁移现有的TSRPC项目？

A: 轻量级TSRPC与传统TSRPC API兼容，可以逐步迁移：

1. 先将现有的协议定义转换为轻量级类型定义
2. 逐个API迁移到新的处理器模式
3. 最后切换到轻量级服务器

### Q: 性能是否有损失？

A: 在大多数场景下性能相当，甚至在小型项目中更优：
- 启动时间更快
- 内存占用更少  
- 支持自动序列化优化

### Q: 如何处理复杂的数据验证？

A: 可以使用自定义验证器或集成第三方验证库：

```typescript
import Joi from 'joi'

const userLoginSchema = Joi.object({
  username: Joi.string().min(3).required(),
  password: Joi.string().min(6).required()
})

server.implementApi('user/login', async (req, context) => {
  const { error } = userLoginSchema.validate(req)
  if (error) {
    throw new Error(`Validation error: ${error.message}`)
  }
  // 处理登录...
})
```

### Q: 如何支持WebSocket？

A: 轻量级架构支持扩展到WebSocket，可以参考HTTP实现创建WebSocket版本。

## 📝 更新日志

### v1.0.0
- 初始版本发布
- 支持运行时协议生成
- HTTP服务器实现
- 完整的中间件系统
- TypeScript类型安全

## 📄 许可证

MIT License