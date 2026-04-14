export const PLATFORM_NAME = 'SharkIQ'

export const PLUGIN_NAME = '@homebridge-plugins/homebridge-sharkiq'

export interface SharkIQPluginConfig {
  name?: string
  email?: string
  password?: string
  oAuthCode?: string
  vacuums?: string[]
  europe?: boolean
  invertDockedStatus?: boolean
  dockedUpdateInterval?: number
  externalAccessory?: boolean
  preferMatter?: boolean
  enableMatter?: boolean
  [key: string]: unknown
}

export const DEFAULT_CONFIG: Partial<SharkIQPluginConfig> = {
  externalAccessory: false,
  preferMatter: true,
  enableMatter: true,
}
