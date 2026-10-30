export interface AuthResponse {
  data: {
    user: User;
    tokens?: {
      accessToken: string;
      refreshToken?: string;
    };
    token?: string;
    refreshToken?: string;
  };
}

export interface User {
  _id?: string;
  socialId?: string;
  signupType?: 'normal' | 'facebook' | 'google';
  email?: string;
  username?: string;
  fullName?: string;
  image?: string;
  emailVerified?: boolean;
  sessions?: [token: string, expiresAt: number];
  roles?: string[];
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
  tokens?: {
    accessToken: string;
    refreshToken: string;
  };
}
