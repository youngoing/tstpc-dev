/**
 * 独立的轻量级服务器基类
 * 不依赖原始的BaseServer，避免循环依赖问题
 */
import {
  LightweightServiceType,
  LightweightApiHandler,
  LightweightMsgHandler,
  LightweightCallContext,
  LightweightFlows,
  LightweightApiReturn,
  LightweightParsedInput,
  LightweightProtocolOptions,
} from "./LightweightTypes"
import { RuntimeProtocolGenerator } from "./RuntimeProtocolGenerator"

/**
 * 轻量级服务器状态枚举
 */
export enum LightweightServerStatus {
  Closed = "CLOSED",
  Opening = "OPENING",
  Opened = "OPENED",
  Closing = "CLOSING",
}

/**
 * 轻量级错误类
 */
export class LightweightError extends Error {
  public readonly code: string
  public readonly type: string

  constructor(message: string, code: string = "SERVER_ERROR", type: string = "ServerError") {
    super(message)
    this.name = "LightweightError"
    this.code = code
    this.type = type
  }
}

/**
 * 轻量级服务器抽象基类
 * 提供运行时协议生成和简化的API定义方式
 */
export abstract class LightweightServer<T extends LightweightServiceType = LightweightServiceType> {
  protected _status: LightweightServerStatus = LightweightServerStatus.Closed
  protected protocolGenerator: RuntimeProtocolGenerator<T>
  protected apiHandlers = new Map<string, LightweightApiHandler>()
  protected msgHandlers = new Map<string, LightweightMsgHandler[]>()
  protected flows: LightweightFlows<T> = {}
  protected connections = new Map<string, any>()

  readonly options: LightweightProtocolOptions

  constructor(options: LightweightProtocolOptions = {}) {
    this.options = {
      enableValidation: true,
      debug: false,
      serializationMode: "auto",
      ...options,
    }

    this.protocolGenerator = new RuntimeProtocolGenerator<T>(this.options)
  }

  /**
   * 启动服务器
   */
  abstract start(): Promise<void>

  /**
   * 停止服务器
   */
  abstract stop(): Promise<void>

  /**
   * 获取服务器状态
   */
  get status(): LightweightServerStatus {
    return this._status
  }

  /**
   * 实现API处理器
   * @param apiName API名称
   * @param handler 处理函数
   */
  implementApi<K extends keyof T["api"]>(
    apiName: K,
    handler: LightweightApiHandler<T["api"][K]["req"], T["api"][K]["res"]>
  ): void {
    const apiNameStr = String(apiName)

    // 注册到协议生成器
    this.protocolGenerator.registerApi(apiName)

    // 保存处理器
    this.apiHandlers.set(apiNameStr, handler)

    this.debug(`注册API处理器: ${apiNameStr}`)
  }

  /**
   * 监听消息
   * @param msgName 消息名称
   * @param handler 处理函数
   */
  listenMsg<K extends keyof T["msg"]>(
    msgName: K,
    handler: LightweightMsgHandler<T["msg"][K]>
  ): void {
    const msgNameStr = String(msgName)

    // 注册到协议生成器
    this.protocolGenerator.registerMsg(msgName)

    // 保存处理器
    if (!this.msgHandlers.has(msgNameStr)) {
      this.msgHandlers.set(msgNameStr, [])
    }
    this.msgHandlers.get(msgNameStr)!.push(handler)

    this.debug(`注册消息处理器: ${msgNameStr}`)
  }

  /**
   * 设置流程处理器
   */
  setFlows(flows: Partial<LightweightFlows<T>>): void {
    this.flows = { ...this.flows, ...flows }
  }

  /**
   * 处理API调用
   */
  async handleApiCall<K extends keyof T["api"]>(
    apiName: K,
    req: T["api"][K]["req"],
    context: LightweightCallContext
  ): Promise<LightweightApiReturn<T["api"][K]["res"]>> {
    const apiNameStr = String(apiName)

    try {
      // 验证请求数据
      if (!this.protocolGenerator.validateRequest(apiName, req)) {
        return {
          isSucc: false,
          err: {
            message: `Invalid request data for API: ${apiNameStr}`,
            code: "INVALID_REQUEST",
            type: "ClientError",
          },
        }
      }

      // 前置流程
      if (this.flows.preApiCall) {
        let shouldContinue = false
        await this.flows.preApiCall(
          { apiName: apiNameStr, req, connId: context.connId },
          context,
          async () => {
            shouldContinue = true
          }
        )
        if (!shouldContinue) {
          return {
            isSucc: false,
            err: {
              message: "API call canceled by preApiCall flow",
              code: "FLOW_CANCELED",
              type: "ServerError",
            },
          }
        }
      }

      // 获取处理器
      const handler = this.apiHandlers.get(apiNameStr)
      if (!handler) {
        return {
          isSucc: false,
          err: {
            message: `No handler found for API: ${apiNameStr}`,
            code: "HANDLER_NOT_FOUND",
            type: "ServerError",
          },
        }
      }

      // 执行处理器
      context.logger.log(`[API] ${apiNameStr}`, this.options.debug ? req : "")
      const startTime = Date.now()
      const result = await handler(req, context)
      const duration = Date.now() - startTime

      // 验证响应数据
      if (!this.protocolGenerator.validateResponse(apiName, result)) {
        return {
          isSucc: false,
          err: {
            message: `Invalid response data for API: ${apiNameStr}`,
            code: "INVALID_RESPONSE",
            type: "ServerError",
          },
        }
      }

      // 前置返回流程
      if (this.flows.preApiReturn) {
        let shouldContinue = false
        await this.flows.preApiReturn(
          { apiName: apiNameStr, res: result, connId: context.connId },
          context,
          async () => {
            shouldContinue = true
          }
        )
        if (!shouldContinue) {
          return {
            isSucc: false,
            err: {
              message: "API return canceled by preApiReturn flow",
              code: "FLOW_CANCELED",
              type: "ServerError",
            },
          }
        }
      }

      context.logger.log(`[API] ${apiNameStr} completed in ${duration}ms`)

      // 后置流程
      if (this.flows.postApiCall) {
        Promise.resolve(
          this.flows.postApiCall(
            { apiName: apiNameStr, req, res: result, connId: context.connId },
            context,
            async () => {}
          )
        ).catch((err: any) => {
          context.logger.error("postApiCall flow error:", err)
        })
      }

      return {
        isSucc: true,
        res: result,
      }
    } catch (error: any) {
      context.logger.error(`API ${apiNameStr} error:`, error)

      if (error instanceof LightweightError) {
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
          message: error.message || "Internal server error",
          code: "INTERNAL_ERROR",
          type: "ServerError",
        },
      }
    }
  }

  /**
   * 处理消息调用
   */
  async handleMsgCall<K extends keyof T["msg"]>(
    msgName: K,
    msg: T["msg"][K],
    context: LightweightCallContext
  ): Promise<void> {
    const msgNameStr = String(msgName)

    try {
      // 验证消息数据
      if (!this.protocolGenerator.validateMessage(msgName, msg)) {
        context.logger.error(`Invalid message data for: ${msgNameStr}`, msg)
        return
      }

      // 前置流程
      if (this.flows.preMsgReceive) {
        let shouldContinue = false
        await this.flows.preMsgReceive(
          { msgName: msgNameStr, msg, connId: context.connId },
          context,
          async () => {
            shouldContinue = true
          }
        )
        if (!shouldContinue) {
          context.logger.debug("Message call canceled by preMsgReceive flow")
          return
        }
      }

      // 获取处理器
      const handlers = this.msgHandlers.get(msgNameStr)
      if (!handlers || handlers.length === 0) {
        context.logger.warn(`No handler found for message: ${msgNameStr}`)
        return
      }

      // 执行所有处理器（并行）
      context.logger.log(`[MSG] ${msgNameStr}`, this.options.debug ? msg : "")
      await Promise.all(
        handlers.map(handler =>
          Promise.resolve(handler(msg, context)).catch(err => {
            context.logger.error(`Message handler error for ${msgNameStr}:`, err)
          })
        )
      )
    } catch (error: any) {
      context.logger.error(`Message ${msgNameStr} error:`, error)
    }
  }

  /**
   * 发送消息到指定连接
   */
  async sendMsg<K extends keyof T["msg"]>(
    connId: string,
    msgName: K,
    msg: T["msg"][K]
  ): Promise<{ isSucc: boolean; errMsg?: string }> {
    const connection = this.connections.get(connId)
    if (!connection) {
      return { isSucc: false, errMsg: `Connection not found: ${connId}` }
    }

    const msgNameStr = String(msgName)

    try {
      // 验证消息数据
      if (!this.protocolGenerator.validateMessage(msgName, msg)) {
        return { isSucc: false, errMsg: `Invalid message data for: ${msgNameStr}` }
      }

      // 前置发送流程
      if (this.flows.preMsgSend) {
        const context = this.createCallContext(connId, connection.ip || "unknown")
        let shouldContinue = false
        await this.flows.preMsgSend({ msgName: msgNameStr, msg, connId }, context, async () => {
          shouldContinue = true
        })
        if (!shouldContinue) {
          return { isSucc: false, errMsg: "Message send canceled by preMsgSend flow" }
        }
      }

      // 序列化并发送
      const serializedData = this.protocolGenerator.serialize({
        type: "msg",
        serviceName: msgNameStr,
        serviceId: this.protocolGenerator.getServiceId(msgNameStr, "msg"),
        data: msg,
      })

      // 这里需要由具体实现来处理发送
      // const result = await connection.sendData(serializedData)
      // if (!result.isSucc) {
      //   return { isSucc: false, errMsg: result.errMsg }
      // }

      return { isSucc: true }
    } catch (error: any) {
      return { isSucc: false, errMsg: error.message || "Send message failed" }
    }
  }

  /**
   * 广播消息到所有连接
   */
  async broadcastMsg<K extends keyof T["msg"]>(
    msgName: K,
    msg: T["msg"][K],
    excludeConnIds?: string[]
  ): Promise<{
    isSucc: boolean
    errMsg?: string
    results: Array<{ connId: string; success: boolean; error?: string }>
  }> {
    const results: Array<{ connId: string; success: boolean; error?: string }> = []
    const excludeSet = new Set(excludeConnIds || [])

    const sendPromises = Array.from(this.connections.entries())
      .filter(([connId]) => !excludeSet.has(connId))
      .map(async ([connId]) => {
        const result = await this.sendMsg(connId, msgName, msg)
        results.push({
          connId,
          success: result.isSucc,
          error: result.errMsg,
        })
      })

    await Promise.all(sendPromises)

    const failedCount = results.filter(r => !r.success).length

    return {
      isSucc: failedCount === 0,
      errMsg: failedCount > 0 ? `${failedCount} connections failed to receive message` : undefined,
      results,
    }
  }

  /**
   * 解析服务器输入数据
   */
  protected parseServerInput(data: string | Uint8Array): LightweightParsedInput<T> | null {
    try {
      const parsed = this.protocolGenerator.deserialize(data)

      if (!parsed.type || !parsed.serviceName) {
        throw new Error("Invalid input format")
      }

      const serviceId = this.protocolGenerator.getServiceId(parsed.serviceName, parsed.type)
      if (serviceId === undefined) {
        throw new Error(`Unknown service: ${parsed.serviceName}`)
      }

      return {
        type: parsed.type,
        serviceName: parsed.serviceName,
        serviceId,
        data: parsed.data,
        sn: parsed.sn,
      }
    } catch (error: any) {
      this.debug("Parse server input error:", error.message)
      return null
    }
  }

  /**
   * 处理连接建立
   */
  protected async onConnect(connId: string, clientIp: string, connection: any): Promise<void> {
    this.connections.set(connId, connection)

    if (this.flows.onConnect) {
      const context = this.createCallContext(connId, clientIp)
      await this.flows.onConnect({ connId, clientIp }, context, async () => {})
    }

    this.debug(`Connection established: ${connId} from ${clientIp}`)
  }

  /**
   * 处理连接断开
   */
  protected async onDisconnect(connId: string, reason?: string): Promise<void> {
    const connection = this.connections.get(connId)
    if (!connection) {
      return
    }

    this.connections.delete(connId)

    if (this.flows.onDisconnect) {
      const context = this.createCallContext(connId, connection.ip || "unknown")
      await this.flows.onDisconnect({ connId, reason }, context, async () => {})
    }

    this.debug(`Connection closed: ${connId}${reason ? ` (${reason})` : ""}`)
  }

  /**
   * 创建调用上下文
   */
  protected createCallContext(connId: string, clientIp: string): LightweightCallContext {
    return {
      connId,
      clientIp,
      startTime: Date.now(),
      logger: {
        log: (...args) => console.log(`[${connId}]`, ...args),
        warn: (...args) => console.warn(`[${connId}]`, ...args),
        error: (...args) => console.error(`[${connId}]`, ...args),
        debug: (...args) => this.options.debug && console.debug(`[${connId}]`, ...args),
      },
    }
  }

  /**
   * 获取协议信息
   */
  getProtocol() {
    return this.protocolGenerator.getProtocol()
  }

  /**
   * 获取协议统计
   */
  getProtocolStats() {
    return this.protocolGenerator.getStats()
  }

  /**
   * 调试日志
   */
  protected debug(...args: any[]): void {
    if (this.options.debug) {
      console.log("[LightweightServer]", ...args)
    }
  }

  /**
   * 获取所有连接
   */
  getConnections(): Array<{ id: string; ip: string; status?: string }> {
    return Array.from(this.connections.entries()).map(([id, conn]) => ({
      id,
      ip: conn.ip || "unknown",
      status: conn.status || "unknown",
    }))
  }

  /**
   * 关闭指定连接
   */
  closeConnection(connId: string, reason?: string): boolean {
    const connection = this.connections.get(connId)
    if (!connection) {
      return false
    }

    if (typeof connection.close === "function") {
      connection.close(reason)
    }
    this.connections.delete(connId)
    return true
  }
}
