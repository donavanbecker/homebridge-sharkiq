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
  /**
   * Use the app's "Matrix Clean" for room cleans instead of a plain clean (#41).
   * Matrix Clean makes two passes in a cross-hatch; the default is the single
   * pass the app's plain "Clean" button does.
   */
  matrixClean?: boolean
  [key: string]: unknown
}

export const DEFAULT_CONFIG: Partial<SharkIQPluginConfig> = {
  externalAccessory: false,
  preferMatter: true,
  enableMatter: true,
}
