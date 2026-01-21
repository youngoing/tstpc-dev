import * as http from "http"
import * as https from "https"
import { LightweightServer, LightweightServerStatus } from "./LightweightServer"
import {
  LightweightServiceType,
  LightweightProtocolOptions,
  LightweightCallContext,
} from "./LightweightTypes"

/**
 * 轻量级HTTP连接类
 */
export class LightweightHttpConnection {
  readonly id: string
  readonly ip: string
  readonly httpReq: http.IncomingMessage
  readonly httpRes: http.ServerResponse
  readonly dataType: "text" | "buffer" | "json"

  constructor(options: {
    id: string
    ip: string
    httpReq: http.IncomingMessage
    httpRes: http.ServerResponse
    dataType: "text" | "buffer" | "json"
  }) {
    this.id = options.id
    this.ip = options.ip
    this.httpReq = options.httpReq
    this.httpRes = options.httpRes
    this.dataType = options.dataType
  }

  get status(): string {
    if (this.httpRes.socket?.writableFinished) {
      return "CLOSED"
    } else if (this.httpRes.socket?.writableEnded) {
      return "CLOSING"
    } else {
      return "OPENED"
    }
  }

  close(reason?: string): void {
    if (this.status !== "OPENED") {
      return
    }

    if (reason) {
      this.httpRes.setHeader("X-TSRPC-Close-Reason", reason)
    }
    this.httpRes.end()
  }
}

/**
 * 轻量级HTTP服务器选项
 */
export interface LightweightHttpServerOptions extends LightweightProtocolOptions {
  /** 监听端口 */
  port: number
  /** HTTPS选项 */
  https?: {
    key: string | Buffer
    cert: string | Buffer
  }
  /** CORS设置 */
  cors?: string
  /** CORS最大缓存时间 */
  corsMaxAge?: number
  /** JSON API路径前缀 */
  jsonHostPath?: string
  /** Socket超时时间 */
  socketTimeout?: number
  /** Keep-Alive超时时间 */
  keepAliveTimeout?: number
  /** 请求体大小限制 */
  maxBodySize?: number
}

/**
 * 轻量级HTTP服务器
 * 提供简化的HTTP API服务，支持JSON和二进制两种数据格式
 */
export class LightweightHttpServer<
  T extends LightweightServiceType = LightweightServiceType,
> extends LightweightServer<T> {
  private httpServer?: http.Server | https.Server
  private readonly serverOptions: Required<LightweightHttpServerOptions>

  constructor(options: Partial<LightweightHttpServerOptions> = {}) {
    super(options)

    this.serverOptions = {
      port: 3000,
      cors: "*",
      corsMaxAge: 3600,
      jsonHostPath: "/api",
      socketTimeout: 30000,
      keepAliveTimeout: 5000,
      maxBodySize: 10 * 1024 * 1024, // 10MB
      enableValidation: true,
      debug: false,
      serializationMode: "auto",
      customValidators: {},
      ...options,
      https: options.https,
    } as Required<LightweightHttpServerOptions>

    // 格式化jsonHostPath
    this.serverOptions.jsonHostPath = this.formatJsonHostPath(this.serverOptions.jsonHostPath)
  }

  /**
   * 启动HTTP服务器
   */
  async start(): Promise<void> {
    if (this.httpServer) {
      throw new Error("Server already started")
    }

    this._status = LightweightServerStatus.Opening

    return new Promise((resolve, reject) => {
      this.debug(`Starting ${this.serverOptions.https ? "HTTPS" : "HTTP"} server...`)

      // 创建服务器
      this.httpServer = this.serverOptions.https
        ? https.createServer(this.serverOptions.https, this.handleRequest.bind(this))
        : http.createServer(this.handleRequest.bind(this))

      // 设置服务器选项
      if (this.serverOptions.socketTimeout) {
        this.httpServer.timeout = this.serverOptions.socketTimeout
      }
      if (this.serverOptions.keepAliveTimeout) {
        this.httpServer.keepAliveTimeout = this.serverOptions.keepAliveTimeout
      }

      // 监听端口
      this.httpServer.listen(this.serverOptions.port, () => {
        this._status = LightweightServerStatus.Opened
        this.debug(`Server started at port ${this.serverOptions.port}`)
        resolve()
      })

      this.httpServer.on("error", error => {
        this._status = LightweightServerStatus.Closed
        reject(error)
      })
    })
  }

  /**
   * 停止HTTP服务器
   */
  async stop(): Promise<void> {
    if (!this.httpServer) {
      return
    }

    this._status = LightweightServerStatus.Closing

    return new Promise<void>((resolve, reject) => {
      this.httpServer!.close(error => {
        this._status = LightweightServerStatus.Closed
        this.httpServer = undefined

        if (error) {
          reject(error)
        } else {
          this.debug("Server stopped")
          resolve()
        }
      })
    })
  }

  /**
   * 处理HTTP请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const connId = this.generateConnectionId()
    const clientIp = this.getClientIp(req)

    try {
      // 设置响应头
      this.setResponseHeaders(res, req)

      // 处理CORS预检请求
      if (req.method === "OPTIONS") {
        res.writeHead(200)
        res.end()
        return
      }

      // 只支持POST请求
      if (req.method !== "POST") {
        this.sendError(res, 405, "Method not allowed")
        return
      }

      // 检查内容类型
      const contentType = req.headers["content-type"] || ""
      const isJson = contentType.toLowerCase().includes("application/json")

      // 读取请求体
      const body = await this.readRequestBody(req)

      if (body.length > this.serverOptions.maxBodySize) {
        this.sendError(res, 413, "Request body too large")
        return
      }

      // 解析URL路径
      const url = req.url || "/"
      const { serviceName, isMsg } = this.parseUrlPath(url)

      if (!serviceName) {
        this.sendError(res, 400, "Invalid API path")
        return
      }

      // 创建连接对象
      const connection = new LightweightHttpConnection({
        id: connId,
        ip: clientIp,
        httpReq: req,
        httpRes: res,
        dataType: isJson ? "json" : "buffer",
      })

      // 处理连接建立
      await this.onConnect(connId, clientIp, connection)

      // 创建调用上下文
      const context = this.createHttpCallContext(connId, clientIp, req, res)

      if (isJson) {
        await this.handleJsonRequest(serviceName, isMsg, body, context, res)
      } else {
        await this.handleBinaryRequest(serviceName, body, context, res)
      }

      // 处理连接断开
      await this.onDisconnect(connId)
    } catch (error: any) {
      this.sendError(res, 500, error.message || "Internal server error")
      console.error(`Request handling error for ${connId}:`, error)
    }
  }

  /**
   * 处理JSON请求
   */
  private async handleJsonRequest(
    serviceName: string,
    isMsg: boolean,
    body: Buffer,
    context: LightweightCallContext,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const data = JSON.parse(body.toString())

      if (isMsg) {
        // 处理消息
        await this.handleMsgCall(serviceName as keyof T["msg"], data, context)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ success: true }))
      } else {
        // 处理API
        const result = await this.handleApiCall(serviceName as keyof T["api"], data, context)

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(result))
      }
    } catch (error: any) {
      this.sendError(res, 400, `JSON parse error: ${error.message}`)
    }
  }

  /**
   * 处理二进制请求
   */
  private async handleBinaryRequest(
    serviceName: string,
    body: Buffer,
    context: LightweightCallContext,
    res: http.ServerResponse
  ): Promise<void> {
    const input = this.parseServerInput(new Uint8Array(body))
    if (!input) {
      this.sendError(res, 400, "Invalid binary data")
      return
    }

    if (input.type === "msg") {
      // 处理消息
      await this.handleMsgCall(input.serviceName as keyof T["msg"], input.data, context)

      const responseData = this.protocolGenerator.serialize({ success: true })
      res.writeHead(200, { "Content-Type": "application/octet-stream" })
      res.end(Buffer.from(responseData as Uint8Array))
    } else {
      // 处理API
      const result = await this.handleApiCall(
        input.serviceName as keyof T["api"],
        input.data,
        context
      )

      const responseData = this.protocolGenerator.serialize({
        ...result,
        sn: input.sn,
      })

      res.writeHead(200, { "Content-Type": "application/octet-stream" })
      res.end(Buffer.from(responseData as Uint8Array))
    }
  }

  /**
   * 设置响应头
   */
  private setResponseHeaders(res: http.ServerResponse, req: http.IncomingMessage): void {
    res.setHeader("X-Powered-By", "TSRPC-Lightweight")

    if (this.serverOptions.cors) {
      res.setHeader("Access-Control-Allow-Origin", this.serverOptions.cors)
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, *")
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")

      if (this.serverOptions.corsMaxAge) {
        res.setHeader("Access-Control-Max-Age", this.serverOptions.corsMaxAge.toString())
      }
    }
  }

  /**
   * 解析URL路径
   */
  private parseUrlPath(url: string): { serviceName?: string; isMsg: boolean } {
    let path = url
    let isMsg = false

    // 解析查询参数
    const queryIndex = url.indexOf("?")
    if (queryIndex !== -1) {
      const queryString = url.slice(queryIndex + 1)
      isMsg = queryString.split("&").includes("type=msg")
      path = url.slice(0, queryIndex)
    }

    // 检查是否匹配jsonHostPath
    if (!path.startsWith(this.serverOptions.jsonHostPath)) {
      return { isMsg }
    }

    // 提取服务名称
    const serviceName = path.slice(this.serverOptions.jsonHostPath.length)

    return { serviceName: serviceName || undefined, isMsg }
  }

  /**
   * 读取请求体
   */
  private readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []

      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })

      req.on("end", () => {
        resolve(Buffer.concat(chunks))
      })

      req.on("error", error => {
        reject(error)
      })
    })
  }

  /**
   * 获取客户端IP
   */
  private getClientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"] as string
    if (forwarded) {
      return forwarded.split(",")[0].trim()
    }

    const realIp = req.headers["x-real-ip"] as string
    if (realIp) {
      return realIp
    }

    return req.socket.remoteAddress || "0.0.0.0"
  }

  /**
   * 发送错误响应
   */
  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
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
   * 生成连接ID
   */
  private generateConnectionId(): string {
    return `http_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 格式化JSON主机路径
   */
  private formatJsonHostPath(path: string): string {
    if (!path.startsWith("/")) {
      path = "/" + path
    }
    if (!path.endsWith("/")) {
      path = path + "/"
    }
    return path
  }

  /**
   * 创建HTTP调用上下文
   */
  private createHttpCallContext(
    connId: string,
    clientIp: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): LightweightCallContext {
    return {
      connId,
      clientIp,
      startTime: Date.now(),
      extra: {
        httpReq: req,
        httpRes: res,
        userAgent: req.headers["user-agent"],
        referer: req.headers["referer"],
      },
      logger: {
        log: (...args) => console.log(`[HTTP ${connId}]`, ...args),
        warn: (...args) => console.warn(`[HTTP ${connId}]`, ...args),
        error: (...args) => console.error(`[HTTP ${connId}]`, ...args),
        debug: (...args) => this.options.debug && console.debug(`[HTTP ${connId}]`, ...args),
      },
    }
  }

  /**
   * 获取服务器信息
   */
  getServerInfo() {
    return {
      status: this.status,
      port: this.serverOptions.port,
      https: !!this.serverOptions.https,
      jsonHostPath: this.serverOptions.jsonHostPath,
      protocolStats: this.getProtocolStats(),
      options: {
        cors: this.serverOptions.cors,
        maxBodySize: this.serverOptions.maxBodySize,
        socketTimeout: this.serverOptions.socketTimeout,
      },
    }
  }
}

/**
 * 创建轻量级HTTP服务器的便捷函数
 */
export function createLightweightHttpServer<T extends LightweightServiceType>(
  options?: Partial<LightweightHttpServerOptions>
): LightweightHttpServer<T> {
  return new LightweightHttpServer<T>(options)
}
