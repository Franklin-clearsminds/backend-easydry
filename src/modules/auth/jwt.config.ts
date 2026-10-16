/** Parámetros de firma y verificación compartidos por la API, el refresh y el WebSocket: así todos validan lo mismo. */
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'easydry-api';
export const JWT_AUDIENCE = 'easydry-clients';

export const JWT_VERIFY_OPTIONS = {
  algorithms: [JWT_ALGORITHM],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

export const JWT_SIGN_OPTIONS = {
  algorithm: JWT_ALGORITHM,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

/** Vida del access token si `JWT_ACCESS_EXPIRATION` no está definida. Corta: el refresh token renueva la sesión. */
export const JWT_ACCESS_DEFAULT = '15m';
export const JWT_REFRESH_DEFAULT = '15d';

/** Cookie HttpOnly con el refresh token del cliente web (la app móvil lo recibe en el cuerpo y lo guarda en el dispositivo). */
export const REFRESH_COOKIE = 'easydry_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
/** El cliente web se identifica con esta cabecera para recibir el refresh token solo por cookie. */
export const CLIENT_HEADER = 'x-client';
export const CLIENT_WEB = 'web';
