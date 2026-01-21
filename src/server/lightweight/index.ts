/**
 * TSRPC 轻量级服务器模块
 * 提供运行时协议生成和简化的API定义方式
 */

// 核心类型定义
export * from './LightweightTypes'

// 运行时协议生成器
export * from './RuntimeProtocolGenerator'

// 轻量级服务器基类
export * from './LightweightServer'

// 轻量级HTTP服务器
export * from './LightweightHttpServer'

// 使用示例
export * from './example'

// 便捷函数
import { createLightweightHttpServer } from './LightweightHttpServer'
import { createRuntimeProtocol } from './RuntimeProtocolGenerator'
import { LightweightServiceType } from './LightweightTypes'

/**
 * 创建轻量级服务器的便捷函数
 */
export const createServer = createLightweightHttpServer

/**
 * 创建协议生成器的便捷函数
 */
export const createProtocol = createRuntimeProtocol

/**
 * 类型辅助函数
 */
export type ServiceType<T extends LightweightServiceType> = T
