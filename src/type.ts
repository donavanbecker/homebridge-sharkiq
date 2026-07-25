interface AuthData {
  access_token: string
  refresh_token: string
  expiration: Date
}

interface OAuthData {
  state: string
  code_verify: string
  code_challenge: string
}

interface Auth0Data {
  id_token: string
  refresh_token: string
  expiration: Date
}

export { Auth0Data, AuthData, OAuthData }
