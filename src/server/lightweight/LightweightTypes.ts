// 移除对外部依赖的导入，避免循环依赖

/**
 * 轻量级API定义接口
 * 只需要定义请求和响应的TypeScript类型，无需复杂的Schema
 */
export interface LightweightApiDefinition {
  [apiName: string]: {
    req: any
    res: any
  }
}

/**
 * 轻量级消息定义接口
 */
export interface LightweightMsgDefinition {
  [msgName: string]: any
}

/**
 * 轻量级服务类型定义
 */
export interface LightweightServiceType {
  api: LightweightApiDefinition
  msg: LightweightMsgDefinition
}

/**
 * 运行时协议信息
 */
export interface RuntimeProtocol<T extends LightweightServiceType = LightweightServiceType> {
  /** 服务类型定义 */
  serviceType: T
  /** API名称列表 */
  apiNames: (keyof T["api"])[]
  /** 消息名称列表 */
  msgNames: (keyof T["msg"])[]
  /** 验证器映射 */
  validators?: {
    api: {
      [K in keyof T["api"]]?: {
        req?: (data: any) => data is T["api"][K]["req"]
        res?: (data: any) => data is T["api"][K]["res"]
      }
    }
    msg: {
      [K in keyof T["msg"]]?: (data: any) => data is T["msg"][K]
    }
  }
}

/**
 * 轻量级服务映射
 */
export interface LightweightServiceMap {
  /** API名称到ID的映射 */
  apiName2Id: Record<string, number>
  /** ID到API名称的映射 */
  id2ApiName: Record<number, string>
  /** 消息名称到ID的映射 */
  msgName2Id: Record<string, number>
  /** ID到消息名称的映射 */
  id2MsgName: Record<number, string>
  /** 下一个可用的服务ID */
  nextId: number
}

/**
 * 轻量级协议选项
 */
export interface LightweightProtocolOptions {
  /** 是否启用运行时验证 */
  enableValidation?: boolean
  /** 是否启用调试模式 */
  debug?: boolean
  /** 序列化模式 */
  serializationMode?: "json" | "binary" | "auto"
  /** 自定义验证器 */
  customValidators?: {
    [serviceName: string]: {
      req?: (data: any) => boolean
      res?: (data: any) => boolean
    }
  }
}

/**
 * 解析后的服务输入
 */
export interface LightweightParsedInput<T extends LightweightServiceType = LightweightServiceType> {
  type: "api" | "msg"
  serviceName: string
  serviceId: number
  data: any
  sn?: number
}

/**
 * API输入
 */
export interface LightweightApiInput<T extends LightweightServiceType = LightweightServiceType>
  extends LightweightParsedInput<T> {
  type: "api"
  data: T["api"][keyof T["api"]]["req"]
}

/**
 * 消息输入
 */
export interface LightweightMsgInput<T extends LightweightServiceType = LightweightServiceType>
  extends LightweightParsedInput<T> {
  type: "msg"
  data: T["msg"][keyof T["msg"]]
}

/**
 * 轻量级API返回
 */
export type LightweightApiReturn<Res = any> =
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
 * API处理器类型
 */
export type LightweightApiHandler<TReq = any, TRes = any> = (
  req: TReq,
  context: LightweightCallContext
) => Promise<TRes> | TRes

/**
 * 消息处理器类型
 */
export type LightweightMsgHandler<TMsg = any> = (
  msg: TMsg,
  context: LightweightCallContext
) => Promise<void> | void

/**
 * 调用上下文
 */
export interface LightweightCallContext {
  /** 连接ID */
  connId: string
  /** 客户端IP */
  clientIp: string
  /** 请求开始时间 */
  startTime: number
  /** 额外的上下文数据 */
  extra?: Record<string, any>
  /** 日志记录器 */
  logger: {
    log: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    debug: (...args: any[]) => void
  }
}

/**
 * 中间件函数类型
 */
export type LightweightMiddleware<T = any> = (
  data: T,
  context: LightweightCallContext,
  next: () => Promise<void>
) => Promise<void> | void

/**
 * 轻量级流程定义
 */
export interface LightweightFlows<T extends LightweightServiceType = LightweightServiceType> {
  /** 连接建立后 */
  onConnect?: LightweightMiddleware<{ connId: string; clientIp: string }>
  /** 连接断开后 */
  onDisconnect?: LightweightMiddleware<{ connId: string; reason?: string }>
  /** 接收数据前 */
  preReceiveData?: LightweightMiddleware<{ data: any; connId: string }>
  /** 发送数据前 */
  preSendData?: LightweightMiddleware<{ data: any; connId: string }>
  /** API调用前 */
  preApiCall?: LightweightMiddleware<{ apiName: string; req: any; connId: string }>
  /** API返回前 */
  preApiReturn?: LightweightMiddleware<{ apiName: string; res: any; connId: string }>
  /** API调用后 */
  postApiCall?: LightweightMiddleware<{ apiName: string; req: any; res: any; connId: string }>
  /** 消息接收前 */
  preMsgReceive?: LightweightMiddleware<{ msgName: string; msg: any; connId: string }>
  /** 消息发送前 */
  preMsgSend?: LightweightMiddleware<{ msgName: string; msg: any; connId: string }>
}

/**
 * 轻量级服务器状态
 */
// 移动到LightweightServer.ts中避免重复定义

/**
 * 简化的服务类型，不依赖外部BaseServiceType
 */
export type SimpleServiceType<T extends LightweightServiceType> = {
  api: {
    [K in keyof T["api"]]: T["api"][K]
  }
  msg: {
    [K in keyof T["msg"]]: T["msg"][K]
  }
}
