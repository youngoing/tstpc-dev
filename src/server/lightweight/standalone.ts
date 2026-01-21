/**
 * 独立的轻量级TSRPC服务器
 * 完全独立，不依赖原始TSRPC的任何组件，避免循环依赖
 */

/**
 * 轻量级服务类型定义
 */
export interface StandaloneServiceType {
  api: Record<string, { req: any; res: any }>
  msg: Record<string, any>
}

/**
 * API返回类型
 */
export type StandaloneApiReturn<Res = any> =
  | {
      isSucc: true
      res: Res
      sn?: number
    }
  | {
      isSucc: false
      err: {
        message: string
        code?: string
        type?: string
      }
      sn?: number
    }

/**
 * 调用上下文
 */
export interface StandaloneCallContext {
  connId: string
  clientIp: string
  startTime: number
  extra?: Record<string, any>
  logger: {
    log: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    debug: (...args: any[]) => void
  }
}

/**
 * API处理器类型
 */
export type StandaloneApiHandler<TReq = any, TRes = any> = (
  req: TReq,
  context: StandaloneCallContext
) => Promise<TRes> | TRes

/**
 * 消息处理器类型
 */
export type StandaloneMsgHandler<TMsg = any> = (
  msg: TMsg,
  context: StandaloneCallContext
) => Promise<void> | void

/**
 * 中间件类型
 */
export type StandaloneMiddleware<T = any> = (
  data: T,
  context: StandaloneCallContext,
  next: () => Promise<void>
) => Promise<void> | void

/**
 * 流程定义
 */
export interface StandaloneFlows<T extends StandaloneServiceType = StandaloneServiceType> {
  onConnect?: StandaloneMiddleware<{ connId: string; clientIp: string }>
  onDisconnect?: StandaloneMiddleware<{ connId: string; reason?: string }>
  preApiCall?: StandaloneMiddleware<{ apiName: string; req: any; connId: string }>
  postApiCall?: StandaloneMiddleware<{ apiName: string; req: any; res: any; connId: string }>
  preMsgReceive?: StandaloneMiddleware<{ msgName: string; msg: any; connId: string }>
}

/**
 * 服务器选项
 */
export interface StandaloneServerOptions {
  port?: number
  jsonHostPath?: string
  cors?: string
  corsMaxAge?: number
  enableValidation?: boolean
  debug?: boolean
  maxBodySize?: number
}

/**
 * 服务器状态
 */
export enum StandaloneServerStatus {
  Closed = "CLOSED",
  Opening = "OPENING",
  Opened = "OPENED",
  Closing = "CLOSING",
}

/**
 * 轻量级错误类
 */
export class StandaloneError extends Error {
  public readonly code: string
  public readonly type: string

  constructor(message: string, code: string = "SERVER_ERROR", type: string = "ServerError") {
    super(message)
    this.name = "StandaloneError"
    this.code = code
    this.type = type
  }
}

/**
 * HTTP连接类
 */
export class StandaloneHttpConnection {
  readonly id: string
  readonly ip: string
  readonly httpReq: any
  readonly httpRes: any

  constructor(id: string, ip: string, httpReq: any, httpRes: any) {
    this.id = id
    this.ip = ip
    this.httpReq = httpReq
    this.httpRes = httpRes
  }

  close(reason?: string): void {
    if (reason) {
      this.httpRes.setHeader("X-Close-Reason", reason)
    }
    this.httpRes.end()
  }
}

/**
 * 独立轻量级HTTP服务器
 */
export class StandaloneHttpServer<T extends StandaloneServiceType = StandaloneServiceType> {
  private _status: StandaloneServerStatus = StandaloneServerStatus.Closed
  private httpServer?: any
  private apiHandlers = new Map<string, StandaloneApiHandler>()
  private msgHandlers = new Map<string, StandaloneMsgHandler[]>()
  private flows: StandaloneFlows<T> = {}
  private connections = new Map<string, StandaloneHttpConnection>()
  private serviceMap = { api: new Map<string, number>(), msg: new Map<string, number>() }
  private nextServiceId = 0

  readonly options: Required<StandaloneServerOptions>

  constructor(options: StandaloneServerOptions = {}) {
    this.options = {
      port: 3000,
      jsonHostPath: "/api",
      cors: "*",
      corsMaxAge: 3600,
      enableValidation: true,
      debug: false,
      maxBodySize: 10 * 1024 * 1024,
      ...options,
    }

    // 格式化路径
    if (!this.options.jsonHostPath.startsWith("/")) {
      this.options.jsonHostPath = "/" + this.options.jsonHostPath
    }
    if (!this.options.jsonHostPath.endsWith("/")) {
      this.options.jsonHostPath = this.options.jsonHostPath + "/"
    }
  }

  get status(): StandaloneServerStatus {
    return this._status
  }

  /**
   * 实现API处理器
   */
  implementApi<K extends keyof T["api"]>(
    apiName: K,
    handler: StandaloneApiHandler<T["api"][K]["req"], T["api"][K]["res"]>
  ): void {
    const apiNameStr = String(apiName)
    this.apiHandlers.set(apiNameStr, handler)

    if (!this.serviceMap.api.has(apiNameStr)) {
      this.serviceMap.api.set(apiNameStr, this.nextServiceId++)
    }

    if (this.options.debug) {
      console.log(`[StandaloneServer] 注册API: ${apiNameStr}`)
    }
  }

  /**
   * 监听消息
   */
  listenMsg<K extends keyof T["msg"]>(
    msgName: K,
    handler: StandaloneMsgHandler<T["msg"][K]>
  ): void {
    const msgNameStr = String(msgName)

    if (!this.msgHandlers.has(msgNameStr)) {
      this.msgHandlers.set(msgNameStr, [])
    }
    this.msgHandlers.get(msgNameStr)!.push(handler)

    if (!this.serviceMap.msg.has(msgNameStr)) {
      this.serviceMap.msg.set(msgNameStr, this.nextServiceId++)
    }

    if (this.options.debug) {
      console.log(`[StandaloneServer] 注册消息: ${msgNameStr}`)
    }
  }

  /**
   * 设置流程处理器
   */
  setFlows(flows: Partial<StandaloneFlows<T>>): void {
    this.flows = { ...this.flows, ...flows }
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.httpServer) {
      throw new Error("Server already started")
    }

    // 动态导入http模块避免循环依赖
    const http = await import("http")

    this._status = StandaloneServerStatus.Opening

    return new Promise((resolve, reject) => {
      if (this.options.debug) {
        console.log(`[StandaloneServer] 启动HTTP服务器...`)
      }

      this.httpServer = http.createServer(this.handleRequest.bind(this))

      this.httpServer.listen(this.options.port, () => {
        this._status = StandaloneServerStatus.Opened
        if (this.options.debug) {
          console.log(`[StandaloneServer] 服务器已启动在端口 ${this.options.port}`)
        }
        resolve()
      })

      this.httpServer.on("error", (error: any) => {
        this._status = StandaloneServerStatus.Closed
        reject(error)
      })
    })
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.httpServer) {
      return
    }

    this._status = StandaloneServerStatus.Closing

    return new Promise<void>((resolve, reject) => {
      this.httpServer!.close((error: any) => {
        this._status = StandaloneServerStatus.Closed
        this.httpServer = undefined

        if (error) {
          reject(error)
        } else {
          if (this.options.debug) {
            console.log("[StandaloneServer] 服务器已停止")
          }
          resolve()
        }
      })
    })
  }

  /**
   * 处理HTTP请求
   */
  private async handleRequest(req: any, res: any): Promise<void> {
    const connId = this.generateConnectionId()
    const clientIp = this.getClientIp(req)

    try {
      // 设置响应头
      this.setResponseHeaders(res, req)

      // 处理CORS预检
      if (req.method === "OPTIONS") {
        res.writeHead(200)
        res.end()
        return
      }

      // 只支持POST
      if (req.method !== "POST") {
        this.sendError(res, 405, "Method not allowed")
        return
      }

      // 读取请求体
      const body = await this.readRequestBody(req)

      if (body.length > this.options.maxBodySize) {
        this.sendError(res, 413, "Request body too large")
        return
      }

      // 解析URL
      const url = req.url || "/"
      const { serviceName, isMsg } = this.parseUrlPath(url)

      if (!serviceName) {
        this.sendError(res, 400, "Invalid API path")
        return
      }

      // 创建连接
      const connection = new StandaloneHttpConnection(connId, clientIp, req, res)
      this.connections.set(connId, connection)

      // 连接建立事件
      if (this.flows.onConnect) {
        await this.executeMiddleware(
          this.flows.onConnect,
          { connId, clientIp },
          this.createCallContext(connId, clientIp, req, res)
        )
      }

      try {
        // 处理请求
        const contentType = req.headers["content-type"] || ""
        const isJson = contentType.toLowerCase().includes("application/json")

        if (isJson) {
          await this.handleJsonRequest(serviceName, isMsg, body, connId, clientIp, req, res)
        } else {
          await this.handleBinaryRequest(serviceName, body, connId, clientIp, req, res)
        }
      } finally {
        // 连接断开事件
        if (this.flows.onDisconnect) {
          await this.executeMiddleware(
            this.flows.onDisconnect,
            { connId, reason: "request_completed" },
            this.createCallContext(connId, clientIp, req, res)
          )
        }
        this.connections.delete(connId)
      }
    } catch (error: any) {
      this.sendError(res, 500, error.message || "Internal server error")
      if (this.options.debug) {
        console.error(`[StandaloneServer] 请求处理错误:`, error)
      }
    }
  }

  /**
   * 处理JSON请求
   */
  private async handleJsonRequest(
    serviceName: string,
    isMsg: boolean,
    body: Buffer,
    connId: string,
    clientIp: string,
    req: any,
    res: any
  ): Promise<void> {
    try {
      const data = JSON.parse(body.toString())
      const context = this.createCallContext(connId, clientIp, req, res)

      if (isMsg) {
        // 处理消息
        await this.handleMsgCall(serviceName, data, context)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: true }))
      } else {
        // 处理API
        const result = await this.handleApiCall(serviceName, data, context)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(result))
      }
    } catch (error: any) {
      this.sendError(res, 400, `JSON解析错误: ${error.message}`)
    }
  }

  /**
   * 处理二进制请求
   */
  private async handleBinaryRequest(
    serviceName: string,
    body: Buffer,
    connId: string,
    clientIp: string,
    req: any,
    res: any
  ): Promise<void> {
    // 简化版二进制处理，直接当作JSON处理
    await this.handleJsonRequest(serviceName, false, body, connId, clientIp, req, res)
  }

  /**
   * 处理API调用
   */
  private async handleApiCall(
    apiName: string,
    req: any,
    context: StandaloneCallContext
  ): Promise<StandaloneApiReturn> {
    try {
      // 前置中间件
      if (this.flows.preApiCall) {
        let shouldContinue = false
        await this.executeMiddleware(
          this.flows.preApiCall,
          { apiName, req, connId: context.connId },
          context,
          () => {
            shouldContinue = true
          }
        )
        if (!shouldContinue) {
          return {
            isSucc: false,
            err: {
              message: "请求被中间件拒绝",
              code: "MIDDLEWARE_REJECTED",
              type: "ServerError",
            },
          }
        }
      }

      // 获取处理器
      const handler = this.apiHandlers.get(apiName)
      if (!handler) {
        return {
          isSucc: false,
          err: {
            message: `未找到API处理器: ${apiName}`,
            code: "HANDLER_NOT_FOUND",
            type: "ServerError",
          },
        }
      }

      // 执行处理器
      context.logger.log(`[API] ${apiName}`)
      const result = await handler(req, context)

      // 后置中间件
      if (this.flows.postApiCall) {
        await this.executeMiddleware(
          this.flows.postApiCall,
          { apiName, req, res: result, connId: context.connId },
          context
        )
      }

      return {
        isSucc: true,
        res: result,
      }
    } catch (error: any) {
      context.logger.error(`API ${apiName} 错误:`, error)

      if (error instanceof StandaloneError) {
        return {
          isSucc: false,
          err: {
            message: error.message,
            code: error.code,
            type: error.type,
          },
        }
      }

      return {
        isSucc: false,
        err: {
          message: error.message || "内部服务器错误",
          code: "INTERNAL_ERROR",
          type: "ServerError",
        },
      }
    }
  }

  /**
   * 处理消息调用
   */
  private async handleMsgCall(
    msgName: string,
    msg: any,
    context: StandaloneCallContext
  ): Promise<void> {
    try {
      // 前置中间件
      if (this.flows.preMsgReceive) {
        let shouldContinue = false
        await this.executeMiddleware(
          this.flows.preMsgReceive,
          { msgName, msg, connId: context.connId },
          context,
          () => {
            shouldContinue = true
          }
        )
        if (!shouldContinue) {
          context.logger.debug("消息被中间件拒绝")
          return
        }
      }

      // 获取处理器
      const handlers = this.msgHandlers.get(msgName)
      if (!handlers || handlers.length === 0) {
        context.logger.warn(`未找到消息处理器: ${msgName}`)
        return
      }

      // 执行处理器
      context.logger.log(`[MSG] ${msgName}`)
      await Promise.all(
        handlers.map(handler =>
          Promise.resolve(handler(msg, context)).catch(err => {
            context.logger.error(`消息处理器错误 ${msgName}:`, err)
          })
        )
      )
    } catch (error: any) {
      context.logger.error(`消息 ${msgName} 错误:`, error)
    }
  }

  /**
   * 执行中间件
   */
  private async executeMiddleware<T>(
    middleware: StandaloneMiddleware<T>,
    data: T,
    context: StandaloneCallContext,
    next?: () => void
  ): Promise<void> {
    let nextCalled = false
    const nextFn = async () => {
      nextCalled = true
      if (next) next()
    }

    await middleware(data, context, nextFn)

    // 如果中间件没有调用next()，调用传入的next
    if (!nextCalled && next) {
      next()
    }
  }

  /**
   * 创建调用上下文
   */
  private createCallContext(
    connId: string,
    clientIp: string,
    req: any,
    res: any
  ): StandaloneCallContext {
    return {
      connId,
      clientIp,
      startTime: Date.now(),
      extra: { httpReq: req, httpRes: res },
      logger: {
        log: (...args) => console.log(`[${connId}]`, ...args),
        warn: (...args) => console.warn(`[${connId}]`, ...args),
        error: (...args) => console.error(`[${connId}]`, ...args),
        debug: (...args) => this.options.debug && console.debug(`[${connId}]`, ...args),
      },
    }
  }

  /**
   * 辅助方法
   */
  private generateConnectionId(): string {
    return `http_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private getClientIp(req: any): string {
    const forwarded = req.headers["x-forwarded-for"]
    if (forwarded) {
      return forwarded.split(",")[0].trim()
    }
    return req.socket?.remoteAddress || "0.0.0.0"
  }

  private setResponseHeaders(res: any, req: any): void {
    res.setHeader("X-Powered-By", "TSRPC-Standalone")

    if (this.options.cors) {
      res.setHeader("Access-Control-Allow-Origin", this.options.cors)
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, *")
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")

      if (this.options.corsMaxAge) {
        res.setHeader("Access-Control-Max-Age", this.options.corsMaxAge.toString())
      }
    }
  }

  private parseUrlPath(url: string): { serviceName?: string; isMsg: boolean } {
    let path = url
    let isMsg = false

    const queryIndex = url.indexOf("?")
    if (queryIndex !== -1) {
      const queryString = url.slice(queryIndex + 1)
      isMsg = queryString.split("&").includes("type=msg")
      path = url.slice(0, queryIndex)
    }

    if (!path.startsWith(this.options.jsonHostPath)) {
      return { isMsg }
    }

    const serviceName = path.slice(this.options.jsonHostPath.length)
    return { serviceName: serviceName || undefined, isMsg }
  }

  private async readRequestBody(req: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []

      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })

      req.on("end", () => {
        resolve(Buffer.concat(chunks))
      })

      req.on("error", (error: any) => {
        reject(error)
      })
    })
  }

  private sendError(res: any, statusCode: number, message: string): void {
    if (res.headersSent) {
      return
    }

    res.writeHead(statusCode, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        isSucc: false,
        err: {
          message,
          code: statusCode.toString(),
          type: "ServerError",
        },
      })
    )
  }

  /**
   * 获取服务器信息
   */
  getServerInfo() {
    return {
      status: this.status,
      port: this.options.port,
      jsonHostPath: this.options.jsonHostPath,
      apiCount: this.apiHandlers.size,
      msgCount: this.msgHandlers.size,
      connectionCount: this.connections.size,
    }
  }
}

/**
 * 创建独立HTTP服务器的便捷函数
 */
export function createStandaloneHttpServer<T extends StandaloneServiceType>(
  options?: StandaloneServerOptions
): StandaloneHttpServer<T> {
  return new StandaloneHttpServer<T>(options)
}

/**
 * 导出所有类型和类
 */
export {
  StandaloneHttpServer as Server,
  StandaloneError as TsrpcError,
  type StandaloneServiceType as ServiceType,
  type StandaloneApiReturn as ApiReturn,
  type StandaloneCallContext as CallContext,
  type StandaloneApiHandler as ApiHandler,
  type StandaloneMsgHandler as MsgHandler,
}
