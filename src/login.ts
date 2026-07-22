import type { Logger } from 'homebridge'

import process from 'node:process'

import { generateURL, getAuthData, getOAuthData, removeFile, setAuthData } from './config.js'
import { global_vars } from './sharkiq-js/const.js'
import { addSeconds } from './utils.js'

interface LoginLogger {
  debug: (message: string, ...parameters: any[]) => void
}

export async function exchangeOAuthCodeForAuthTokens(
  auth_file: string,
  oauth_file: string,
  code: string,
  europe = false,
  app_id?: string,
  app_secret?: string,
  log?: LoginLogger,
): Promise<void> {
  const oauthConfig = europe ? global_vars.EU_OAUTH : global_vars.OAUTH
  const loginUrl = europe ? global_vars.EU_LOGIN_URL : global_vars.LOGIN_URL
  const resolvedAppId = app_id || (europe ? global_vars.EU_SHARK_APP_ID : global_vars.SHARK_APP_ID)
  const resolvedAppSecret = app_secret || (europe ? global_vars.EU_SHARK_APP_SECRET : global_vars.SHARK_APP_SECRET)
  const oAuthData = await getOAuthData(oauth_file)

  const data = {
    grant_type: 'authorization_code',
    client_id: oauthConfig.CLIENT_ID,
    code,
    code_verifier: oAuthData.code_verify,
    redirect_uri: oauthConfig.REDIRECT_URI,
  }

  const reqData = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Auth0-Client': oauthConfig.AUTH0_CLIENT,
    },
    body: JSON.stringify(data),
  }
  log?.debug('Request Data', JSON.stringify(data))

  const response = await fetch(oauthConfig.TOKEN_URL, reqData)
  if (!response.ok) {
    return Promise.reject(new Error(`Unable to get token data. HTTP ${response.status}`))
  }
  const tokenData = await response.json() as { id_token: string }
  log?.debug('Token Data:', JSON.stringify(tokenData))

  const reqData2 = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: resolvedAppId,
      app_secret: resolvedAppSecret,
      token: tokenData.id_token,
    }),
  // eslint-disable-next-line no-undef -- RequestInit is a global DOM type validated by tsc
  } as RequestInit

  const response2 = await fetch(`${loginUrl}/api/v1/token_sign_in`, reqData2)
  if (!response2.ok) {
    return Promise.reject(new Error(`Unable to get authorization tokens. HTTP ${response2.status}`))
  }

  const aylaTokenData = await response2.json() as { expires_in: number } & Record<string, any>
  const dateNow = new Date()
  aylaTokenData.expiration = addSeconds(dateNow, aylaTokenData.expires_in)
  log?.debug('Setting auth data...', JSON.stringify(aylaTokenData))

  await setAuthData(auth_file, aylaTokenData as unknown as import('./type').AuthData)
  await removeFile(oauth_file).catch(() => undefined)
}

export class Login {
  public log: Logger
  public auth_file: string
  public oauth_file: string
  public email: string
  public password: string
  public app_id: string
  public app_secret: string
  public oAuthCode: string
  public europe: boolean

  constructor(log: Logger, auth_file: string, oauth_file: string, email: string, password: string, oAuthCode: string, europe = false, app_id?: string, app_secret?: string) {
    this.log = log
    this.auth_file = auth_file
    this.oauth_file = oauth_file
    this.email = email
    this.password = password
    this.oAuthCode = oAuthCode
    this.europe = europe
    this.app_id = app_id || (europe ? global_vars.EU_SHARK_APP_ID : global_vars.SHARK_APP_ID)
    this.app_secret = app_secret || (europe ? global_vars.EU_SHARK_APP_SECRET : global_vars.SHARK_APP_SECRET)
  }

  public async checkLogin(): Promise<void> {
    try {
      await getAuthData(this.auth_file)
      this.log.debug('Already logged in to Shark')
    } catch {
      this.log.debug('Not logged in to Shark')
      const email = this.email
      const password = this.password

      const architecture = process.arch
      const platform = process.platform
      if (email === '' && password === '') {
        if (this.oAuthCode === '') {
          try {
            const url = await generateURL(this.oauth_file, this.europe)
            return Promise.reject(new Error(`Please login to Shark using the following URL: ${url}`))
          } catch (error) {
            return Promise.reject(error)
          }
        } else {
          try {
            await this.loginCallback(this.oAuthCode)
          } catch (error) {
            this.log.warn('OAuth data not found with OAuth code set. Please clear the OAuth code and try again.')
            return Promise.reject(error)
          }
        }
      } else {
        this.log.warn(`Automatic browser login is disabled on ${platform} ${architecture}.`)
        this.log.info('Use OAuth login from the Homebridge UI, or set oAuthCode in config.')
        const url = await generateURL(this.oauth_file, this.europe)
        return Promise.reject(new Error(`Please login to Shark using the following URL: ${url}`))
      }
    }
  }

  private async loginCallback(code: string): Promise<void> {
    await exchangeOAuthCodeForAuthTokens(
      this.auth_file,
      this.oauth_file,
      code,
      this.europe,
      this.app_id,
      this.app_secret,
      this.log,
    )
  }
}
