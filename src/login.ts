import type { Logger } from 'homebridge'

import { join } from 'node:path'
import process from 'node:process'

import { generateURL, getAuthData, getOAuthData, removeFile, setAuth0Data, setAuthData } from './config.js'
import { global_vars } from './sharkiq-js/const.js'
import { addSeconds } from './utils.js'

interface LoginLogger {
  debug: (message: string, ...parameters: any[]) => void
}

/**
 * Turn a failed token exchange into something a user can act on.
 *
 * A 403 here is by far the most common failure and it almost never means what
 * the bare status suggests. The login code is single-use and short-lived, so
 * it is already spent if the SharkClean app opened the callback (it treats it
 * as an Alexa-style account link, consuming the code and showing a "Linking
 * Error"), and it is stale if the sign-in happened a while ago or against an
 * older login URL. Reported repeatedly in #84 and #85, where the bare
 * `HTTP 403` sent people looking for a problem with their account.
 */
export function describeTokenExchangeFailure(status: number): string {
  if (status === 403 || status === 401) {
    return `Unable to get token data. HTTP ${status} - this usually means the login code has already been used or has expired, rather than a problem with your account. `
      + 'Generate a fresh login URL, sign in again, and exchange the new code straight away. '
      + 'If the SharkClean app opened when you accepted, it consumed the code - use a browser on a computer that does not have the app installed.'
  }
  return `Unable to get token data. HTTP ${status}`
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
  // Report what was sent, never the values. This body carries the PKCE code
  // verifier and the single-use authorization code; the responses below carry the
  // id, access and refresh tokens. Anyone turning debug on to troubleshoot a login
  // - exactly when these fire - and then pasting the log into a GitHub issue used
  // to publish a working refresh token for their SharkNinja account, and a refresh
  // token is long lived.
  log?.debug('Request Data keys:', Object.keys(data).join(', '))

  const response = await fetch(oauthConfig.TOKEN_URL, reqData)
  if (!response.ok) {
    return Promise.reject(new Error(describeTokenExchangeFailure(response.status)))
  }
  const tokenData = await response.json() as { id_token: string, refresh_token?: string, expires_in?: number }
  log?.debug('Token Data received:', [
    `id_token: ${tokenData.id_token ? 'present' : 'missing'}`,
    `refresh_token: ${tokenData.refresh_token ? 'present' : 'missing'}`,
    `expires_in: ${tokenData.expires_in ?? 'not given'}`,
  ].join(', '))

  // Keep the Auth0 token set too - the newer SharkNinja device API signs its
  // requests with the id_token directly, and the refresh token lets the
  // plugin renew it without another browser sign-in
  if (tokenData.refresh_token) {
    const auth0File = join(auth_file, '..', global_vars.AUTH0_FILE)
    await setAuth0Data(auth0File, {
      id_token: tokenData.id_token,
      refresh_token: tokenData.refresh_token,
      expiration: addSeconds(new Date(), tokenData.expires_in ?? 3600),
    }).catch(() => undefined)
  }

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
  log?.debug('Setting auth data...', [
    `access_token: ${aylaTokenData.access_token ? 'present' : 'missing'}`,
    `refresh_token: ${aylaTokenData.refresh_token ? 'present' : 'missing'}`,
    `expiration: ${aylaTokenData.expiration}`,
  ].join(', '))

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
