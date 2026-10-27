export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface CreateRefreshTokenInput {
  id: string;
  userId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id — pairs the access token with a refresh-token family
}
