import { LightweightServiceType, LightweightServiceMap, RuntimeProtocol, LightweightProtocolOptions } from "./LightweightTypes"

/**
 * 运行时协议生成器
 * 在运行时动态生成协议信息，避免大量的预生成协议文件
 */
export class RuntimeProtocolGenerator<T extends LightweightServiceType = LightweightServiceType> {
  private serviceMap: LightweightServiceMap
  private protocol: RuntimeProtocol<T>
  private options: Required<LightweightProtocolOptions>

  constructor(options: LightweightProtocolOptions = {}) {
    this.options = {
      enableValidation: options.enableValidation ?? true,
      debug: options.debug ?? false,
      serializationMode: options.serializationMode ?? 'auto',
      customValidators: options.customValidators ?? {}
    }

    this.serviceMap = {
      apiName2Id: {},
      id2ApiName: {},
      msgName2Id: {},
      id2MsgName: {},
      nextId: 0
    }

    this.protocol = {
      serviceType: {} as T,
      apiNames: [],
      msgNames: [],
      validators: {
        api: {} as any,
        msg: {} as any
      }
    }
  }

  /**
   * 注册API服务
   */
  registerApi<K extends keyof T['api']>(
    apiName: K,
    validator?: {
      req?: (data: any) => data is T['api'][K]['req']
      res?: (data: any) => data is T['api'][K]['res']
    }
  ): number {
    const apiNameStr = apiName as string

    // 如果已经注册过，返回现有ID
    if (this.serviceMap.apiName2Id[apiNameStr] !== undefined) {
      return this.serviceMap.apiName2Id[apiNameStr]
    }

    const serviceId = this.serviceMap.nextId++
    this.serviceMap.apiName2Id[apiNameStr] = serviceId
    this.serviceMap.id2ApiName[serviceId] = apiNameStr

    // 添加到协议信息
    if (!this.protocol.apiNames.includes(apiName)) {
      this.protocol.apiNames.push(apiName)
    }

    // 设置验证器
    if (validator && this.options.enableValidation) {
      if (!this.protocol.validators) {
        this.protocol.validators = { api: {} as any, msg: {} as any }
      }
      this.protocol.validators.api[apiName] = validator
    }

    this.debug(`注册API: ${apiNameStr} -> ID: ${serviceId}`)
    return serviceId
  }

  /**
   * 注册消息服务
   */
  registerMsg<K extends keyof T['msg']>(
    msgName: K,
    validator?: (data: any) => data is T['msg'][K]
  ): number {
    const msgNameStr = msgName as string

    // 如果已经注册过，返回现有ID
    if (this.serviceMap.msgName2Id[msgNameStr] !== undefined) {
      return this.serviceMap.msgName2Id[msgNameStr]
    }

    const serviceId = this.serviceMap.nextId++
    this.serviceMap.msgName2Id[msgNameStr] = serviceId
    this.serviceMap.id2MsgName[serviceId] = msgNameStr

    // 添加到协议信息
    if (!this.protocol.msgNames.includes(msgName)) {
      this.protocol.msgNames.push(msgName)
    }

    // 设置验证器
    if (validator && this.options.enableValidation) {
      if (!this.protocol.validators) {
        this.protocol.validators = { api: {} as any, msg: {} as any }
      }
      this.protocol.validators.msg[msgName] = validator
    }

    this.debug(`注册消息: ${msgNameStr} -> ID: ${serviceId}`)
    return serviceId
  }

  /**
   * 根据服务名称获取服务ID
   */
  getServiceId(serviceName: string, type: 'api' | 'msg'): number | undefined {
    if (type === 'api') {
      return this.serviceMap.apiName2Id[serviceName]
    } else {
      return this.serviceMap.msgName2Id[serviceName]
    }
  }

  /**
   * 根据服务ID获取服务名称
   */
  getServiceName(serviceId: number, type: 'api' | 'msg'): string | undefined {
    if (type === 'api') {
      return this.serviceMap.id2ApiName[serviceId]
    } else {
      return this.serviceMap.id2MsgName[serviceId]
    }
  }

  /**
   * 验证请求数据
   */
  validateRequest<K extends keyof T['api']>(
    apiName: K,
    data: any
  ): data is T['api'][K]['req'] {
    if (!this.options.enableValidation) {
      return true
    }

    const validator = this.protocol.validators?.api[apiName]?.req
    if (validator) {
      const isValid = validator(data)
      if (!isValid) {
        this.debug(`API请求验证失败: ${String(apiName)}`, data)
      }
      return isValid
    }

    // 如果没有验证器，使用自定义验证器
    const customValidator = this.options.customValidators[apiName as string]?.req
    if (customValidator) {
      return customValidator(data)
    }

    return true
  }

  /**
   * 验证响应数据
   */
  validateResponse<K extends keyof T['api']>(
    apiName: K,
    data: any
  ): data is T['api'][K]['res'] {
    if (!this.options.enableValidation) {
      return true
    }

    const validator = this.protocol.validators?.api[apiName]?.res
    if (validator) {
      const isValid = validator(data)
      if (!isValid) {
        this.debug(`API响应验证失败: ${String(apiName)}`, data)
      }
      return isValid
    }

    // 如果没有验证器，使用自定义验证器
    const customValidator = this.options.customValidators[apiName as string]?.res
    if (customValidator) {
      return customValidator(data)
    }

    return true
  }

  /**
   * 验证消息数据
   */
  validateMessage<K extends keyof T['msg']>(
    msgName: K,
    data: any
  ): data is T['msg'][K] {
    if (!this.options.enableValidation) {
      return true
    }

    const validator = this.protocol.validators?.msg[msgName]
    if (validator) {
      const isValid = validator(data)
      if (!isValid) {
        this.debug(`消息验证失败: ${String(msgName)}`, data)
      }
      return isValid
    }

    return true
  }

  /**
   * 获取协议信息
   */
  getProtocol(): RuntimeProtocol<T> {
    return this.protocol
  }

  /**
   * 获取服务映射
   */
  getServiceMap(): LightweightServiceMap {
    return this.serviceMap
  }

  /**
   * 序列化数据
   */
  serialize(data: any, type: 'json' | 'binary' | 'auto' = this.options.serializationMode): string | Uint8Array {
    if (type === 'auto') {
      // 根据数据大小和复杂度自动选择序列化方式
      const jsonStr = JSON.stringify(data)
      if (jsonStr.length > 1024) {
        type = 'binary'
      } else {
        type = 'json'
      }
    }

    if (type === 'json') {
      return JSON.stringify(data)
    } else {
      // 简单的二进制序列化（实际项目中可以使用msgpack或protobuf）
      const jsonStr = JSON.stringify(data)
      return new TextEncoder().encode(jsonStr)
    }
  }

  /**
   * 反序列化数据
   */
  deserialize(data: string | Uint8Array): any {
    if (typeof data === 'string') {
      return JSON.parse(data)
    } else {
      const jsonStr = new TextDecoder().decode(data)
      return JSON.parse(jsonStr)
    }
  }

  /**
   * 生成兼容TSRPC的协议对象
   */
  generateCompatibleProtocol(): {
    services: Array<{ id: number; name: string; type: 'api' | 'msg' }>
    types: Record<string, any>
  } {
    const services: Array<{ id: number; name: string; type: 'api' | 'msg' }> = []

    // 添加API服务
    for (const [apiName, id] of Object.entries(this.serviceMap.apiName2Id)) {
      services.push({ id, name: apiName, type: 'api' })
    }

    // 添加消息服务
    for (const [msgName, id] of Object.entries(this.serviceMap.msgName2Id)) {
      services.push({ id, name: msgName, type: 'msg' })
    }

    // 类型信息（轻量级实现，不包含详细的Schema）
    const types: Record<string, any> = {}

    // 为每个服务生成简化的类型定义
    for (const service of services) {
      if (service.type === 'api') {
        types[`${service.name}/Req`] = {
          type: 'Interface',
          properties: [] // 运行时动态推断
        }
        types[`${service.name}/Res`] = {
          type: 'Interface',
          properties: [] // 运行时动态推断
        }
      } else {
        types[`${service.name}/Msg`] = {
          type: 'Interface',
          properties: [] // 运行时动态推断
        }
      }
    }

    return { services, types }
  }

  /**
   * 重置协议生成器
   */
  reset(): void {
    this.serviceMap = {
      apiName2Id: {},
      id2ApiName: {},
      msgName2Id: {},
      id2MsgName: {},
      nextId: 0
    }

    this.protocol = {
      serviceType: {} as T,
      apiNames: [],
      msgNames: [],
      validators: {
        api: {} as any,
        msg: {} as any
      }
    }
  }

  /**
   * 调试日志
   */
  private debug(...args: any[]): void {
    if (this.options.debug) {
      console.log('[RuntimeProtocolGenerator]', ...args)
    }
  }

  /**
   * 获取协议统计信息
   */
  getStats() {
    return {
      totalApis: Object.keys(this.serviceMap.apiName2Id).length,
      totalMsgs: Object.keys(this.serviceMap.msgName2Id).length,
      totalServices: this.serviceMap.nextId,
      validationEnabled: this.options.enableValidation,
      serializationMode: this.options.serializationMode
    }
  }
}

/**
 * 创建运行时协议生成器的便捷函数
 */
export function createRuntimeProtocol<T extends LightweightServiceType>(
  options?: LightweightProtocolOptions
): RuntimeProtocolGenerator<T> {
  return new RuntimeProtocolGenerator<T>(options)
}
