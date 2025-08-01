import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as AppleStrategy } from 'passport-apple';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
import logger from '../utils/logger';
import { BadRequestError, UnauthorizedError, ForbiddenError } from '../utils/errors';
import { sendEmail } from './email.service';
import { generateRandomString } from '../utils/helpers';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const JWT_ISSUER = process.env.JWT_ISSUER || 'college-whisper-api';

// OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const APPLE_KEY_ID = process.env.APPLE_KEY_ID;
const APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY;

// Initialize OAuth clients
const googleClient = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
  ? new OAuth2Client(GOOGLE_CLIENT_ID)
  : null;

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  tokenId: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

interface SocialProfile {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  provider: 'google' | 'facebook' | 'apple';
  emailVerified?: boolean;
}

class AuthService {
  /**
   * Generate JWT tokens for a user
   */
  private generateTokens(userId: string, email: string, role: string): AuthTokens {
    const tokenId = uuidv4();
    const accessToken = jwt.sign(
      { userId, email, role, tokenId } as TokenPayload,
      JWT_SECRET,
      { 
        expiresIn: JWT_ACCESS_EXPIRES_IN,
        issuer: JWT_ISSUER,
      }
    );

    const refreshToken = jwt.sign(
      { userId, email, role, tokenId } as TokenPayload,
      JWT_SECRET,
      { 
        expiresIn: JWT_REFRESH_EXPIRES_IN,
        issuer: JWT_ISSUER,
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
      tokenType: 'Bearer',
    };
  }

  /**
   * Store refresh token in the database
   */
  private async storeRefreshToken(userId: string, tokenId: string, refreshToken: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await db('refresh_tokens').insert({
      id: tokenId,
      user_id: userId,
      token: refreshToken,
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  /**
   * Verify and decode JWT token
   */
  public verifyToken(token: string, ignoreExpiration = false): TokenPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { 
        issuer: JWT_ISSUER,
        ignoreExpiration,
      }) as TokenPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
      }
      throw error;
    }
  }

  /**
   * Register a new user with email and password
   */
  public async register(email: string, password: string, name: string): Promise<AuthTokens> {
    // Check if user already exists
    const existingUser = await db('users').where({ email }).first();
    if (existingUser) {
      throw new BadRequestError('Email already in use', 'EMAIL_IN_USE');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const [userId] = await db('users').insert({
      id: uuidv4(),
      email,
      password: hashedPassword,
      name,
      username: await this.generateUniqueUsername(name),
      email_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('id');

    // Generate verification token
    const verificationToken = jwt.sign(
      { userId, email, purpose: 'email_verification' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Verify your email',
      template: 'verify-email',
      data: {
        name,
        verificationUrl: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`,
      },
    });

    // Generate tokens
    return this.generateTokens(userId, email, 'user');
  }

  /**
   * Login with email and password
   */
  public async login(email: string, password: string): Promise<AuthTokens> {
    // Find user by email
    const user = await db('users')
      .where({ email })
      .select('id', 'email', 'password', 'role', 'is_active', 'email_verified')
      .first();

    // Check if user exists and is active
    if (!user || !user.is_active) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    // Check if email is verified (optional, depending on your requirements)
    if (!user.email_verified) {
      throw new ForbiddenError('Please verify your email address', 'EMAIL_NOT_VERIFIED');
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email, user.role);
    await this.storeRefreshToken(user.id, tokens.tokenId, tokens.refreshToken);

    // Update last login
    await db('users')
      .where({ id: user.id })
      .update({ last_login: new Date() });

    return tokens;
  }

  /**
   * Refresh access token using refresh token
   */
  public async refreshToken(refreshToken: string): Promise<AuthTokens> {
    // Verify refresh token
    let decoded: TokenPayload;
    try {
      decoded = this.verifyToken(refreshToken) as TokenPayload;
    } catch (error) {
      throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // Check if refresh token exists in the database
    const tokenRecord = await db('refresh_tokens')
      .where({
        id: decoded.tokenId,
        user_id: decoded.userId,
        revoked: false,
      })
      .first();

    if (!tokenRecord || tokenRecord.token !== refreshToken) {
      throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // Check if token is expired
    if (new Date() > new Date(tokenRecord.expires_at)) {
      // Revoke the expired token
      await db('refresh_tokens')
        .where({ id: decoded.tokenId })
        .update({ revoked: true });
      
      throw new UnauthorizedError('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
    }

    // Get user details
    const user = await db('users')
      .where({ id: decoded.userId, is_active: true })
      .select('id', 'email', 'role')
      .first();

    if (!user) {
      throw new UnauthorizedError('User not found or inactive', 'USER_NOT_FOUND');
    }

    // Generate new tokens
    const tokens = this.generateTokens(user.id, user.email, user.role);
    
    // Revoke the old refresh token
    await db('refresh_tokens')
      .where({ id: decoded.tokenId })
      .update({ revoked: true });
    
    // Store the new refresh token
    await this.storeRefreshToken(user.id, tokens.tokenId, tokens.refreshToken);

    return tokens;
  }

  /**
   * Logout by revoking the current refresh token
   */
  public async logout(refreshToken: string): Promise<void> {
    try {
      const decoded = this.verifyToken(refreshToken, true) as TokenPayload;
      
      // Revoke the refresh token
      await db('refresh_tokens')
        .where({ id: decoded.tokenId })
        .update({ revoked: true });
    } catch (error) {
      // If token is already invalid, just log and continue
      logger.warn('Error during logout:', error);
    }
  }

  /**
   * Verify user's email using verification token
   */
  public async verifyEmail(token: string): Promise<void> {
    let decoded: { userId: string; email: string; purpose: string };
    
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
      
      if (decoded.purpose !== 'email_verification') {
        throw new BadRequestError('Invalid verification token', 'INVALID_TOKEN');
      }
    } catch (error) {
      throw new BadRequestError('Invalid or expired verification token', 'INVALID_TOKEN');
    }

    // Update user's email verification status
    const updated = await db('users')
      .where({ id: decoded.userId, email: decoded.email })
      .update({ 
        email_verified: true,
        updated_at: new Date(),
      });

    if (!updated) {
      throw new BadRequestError('User not found', 'USER_NOT_FOUND');
    }
  }

  /**
   * Request password reset
   */
  public async requestPasswordReset(email: string): Promise<void> {
    const user = await db('users')
      .where({ email })
      .select('id', 'name', 'email')
      .first();

    if (!user) {
      // For security, don't reveal if the email exists or not
      return;
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, email: user.email, purpose: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Send password reset email
    await sendEmail({
      to: user.email,
      subject: 'Reset your password',
      template: 'reset-password',
      data: {
        name: user.name,
        resetUrl: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`,
      },
    });
  }

  /**
   * Reset password using reset token
   */
  public async resetPassword(token: string, newPassword: string): Promise<void> {
    let decoded: { userId: string; email: string; purpose: string };
    
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
      
      if (decoded.purpose !== 'password_reset') {
        throw new BadRequestError('Invalid reset token', 'INVALID_TOKEN');
      }
    } catch (error) {
      throw new BadRequestError('Invalid or expired reset token', 'INVALID_TOKEN');
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update user's password
    const updated = await db('users')
      .where({ id: decoded.userId, email: decoded.email })
      .update({ 
        password: hashedPassword,
        updated_at: new Date(),
      });

    if (!updated) {
      throw new BadRequestError('User not found', 'USER_NOT_FOUND');
    }

    // Revoke all user's refresh tokens
    await db('refresh_tokens')
      .where({ user_id: decoded.userId })
      .update({ revoked: true });
  }

  /**
   * Authenticate with Google
   */
  public async authenticateWithGoogle(idToken: string): Promise<AuthTokens> {
    if (!googleClient) {
      throw new Error('Google OAuth is not configured');
    }

    try {
      // Verify the Google ID token
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      
      if (!payload || !payload.email) {
        throw new BadRequestError('Invalid Google token', 'INVALID_GOOGLE_TOKEN');
      }

      // Create or get user
      const user = await this.getOrCreateUserFromSocial({
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        firstName: payload.given_name,
        lastName: payload.family_name,
        avatar: payload.picture,
        provider: 'google',
        emailVerified: payload.email_verified,
      });

      // Generate tokens
      const tokens = this.generateTokens(user.id, user.email, user.role);
      await this.storeRefreshToken(user.id, tokens.tokenId, tokens.refreshToken);

      return tokens;
    } catch (error) {
      logger.error('Google authentication error:', error);
      throw new UnauthorizedError('Google authentication failed', 'GOOGLE_AUTH_FAILED');
    }
  }

  /**
   * Get Facebook authentication strategy
   */
  public getFacebookStrategy(): FacebookStrategy | null {
    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
      return null;
    }

    return new FacebookStrategy(
      {
        clientID: FACEBOOK_APP_ID,
        clientSecret: FACEBOOK_APP_SECRET,
        callbackURL: `${process.env.API_URL}/api/auth/facebook/callback`,
        profileFields: ['id', 'emails', 'name', 'photos'],
        scope: ['email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0].value;
          
          if (!email) {
            return done(new Error('No email provided by Facebook'), null);
          }

          const user = await this.getOrCreateUserFromSocial({
            id: profile.id,
            email,
            name: `${profile.name?.givenName} ${profile.name?.familyName}`.trim(),
            firstName: profile.name?.givenName,
            lastName: profile.name?.familyName,
            avatar: profile.photos?.[0]?.value,
            provider: 'facebook',
            emailVerified: true, // Facebook verifies emails
          });

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    );
  }

  /**
   * Get Apple authentication strategy
   */
  public getAppleStrategy(): AppleStrategy | null {
    if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
      return null;
    }

    return new AppleStrategy(
      {
        clientID: APPLE_CLIENT_ID,
        teamID: APPLE_TEAM_ID,
        keyID: APPLE_KEY_ID,
        key: APPLE_PRIVATE_KEY,
        callbackURL: `${process.env.API_URL}/api/auth/apple/callback`,
        scope: ['email', 'name'],
      },
      async (accessToken, refreshToken, idToken, profile, done) => {
        try {
          if (!idToken) {
            return done(new Error('No ID token provided by Apple'), null);
          }

          // Decode the ID token to get user info
          const decoded = jwt.decode(idToken) as any;
          const email = decoded.email;
          
          if (!email) {
            return done(new Error('No email provided by Apple'), null);
          }

          // Apple may not return the name in the profile, so we use the name from the ID token
          const name = profile?.name
            ? `${profile.name.firstName || ''} ${profile.name.lastName || ''}`.trim()
            : '';

          const user = await this.getOrCreateUserFromSocial({
            id: decoded.sub,
            email,
            name,
            provider: 'apple',
            emailVerified: true, // Apple verifies emails
          });

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    );
  }

  /**
   * Get or create a user from social profile
   */
  private async getOrCreateUserFromSocial(profile: SocialProfile) {
    // Start a transaction
    return db.transaction(async (trx) => {
      // Check if a social account already exists
      const existingSocialAccount = await trx('user_social_accounts')
        .where({
          provider: profile.provider,
          provider_user_id: profile.id,
        })
        .first();

      let userId: string;

      if (existingSocialAccount) {
        // Update the existing user's last login
        userId = existingSocialAccount.user_id;
        
        await trx('users')
          .where({ id: userId })
          .update({ 
            last_login: new Date(),
            updated_at: new Date(),
            // Update avatar if it's not set
            ...(!existingSocialAccount.avatar && profile.avatar ? { avatar: profile.avatar } : {}),
          });
      } else {
        // Check if a user with this email already exists
        let user = await trx('users')
          .where({ email: profile.email })
          .first();

        if (user) {
          // Link the social account to the existing user
          userId = user.id;
          
          await trx('user_social_accounts').insert({
            id: uuidv4(),
            user_id: userId,
            provider: profile.provider,
            provider_user_id: profile.id,
            email: profile.email,
            name: profile.name,
            avatar: profile.avatar,
            created_at: new Date(),
            updated_at: new Date(),
          });

          // Update user's last login
          await trx('users')
            .where({ id: userId })
            .update({ 
              last_login: new Date(),
              // Update avatar if it's not set
              ...(!user.avatar && profile.avatar ? { avatar: profile.avatar } : {}),
            });
        } else {
          // Create a new user
          const username = await this.generateUniqueUsername(
            profile.name || profile.email.split('@')[0]
          );

          const [newUserId] = await trx('users').insert({
            id: uuidv4(),
            email: profile.email,
            name: profile.name || profile.email.split('@')[0],
            username,
            avatar: profile.avatar,
            email_verified: profile.emailVerified || false,
            is_active: true,
            last_login: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          }).returning('id');

          userId = newUserId;

          // Create the social account
          await trx('user_social_accounts').insert({
            id: uuidv4(),
            user_id: userId,
            provider: profile.provider,
            provider_user_id: profile.id,
            email: profile.email,
            name: profile.name,
            avatar: profile.avatar,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      // Get the user with role
      const user = await trx('users')
        .where('users.id', userId)
        .select('users.*', 'roles.name as role')
        .leftJoin('user_roles', 'users.id', 'user_roles.user_id')
        .leftJoin('roles', 'user_roles.role_id', 'roles.id')
        .first();

      if (!user) {
        throw new Error('Failed to create or retrieve user');
      }

      return {
        id: user.id,
        email: user.email,
        role: user.role || 'user',
      };
    });
  }

  /**
   * Generate a unique username from a name
   */
  private async generateUniqueUsername(name: string): Promise<string> {
    // Convert name to a URL-friendly format
    let baseUsername = name
      .toLowerCase()
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^\w-]/g, '') // Remove special characters
      .replace(/_+/g, '_') // Replace multiple underscores with a single one
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .substring(0, 20); // Limit length

    if (!baseUsername) {
      baseUsername = 'user' + Math.random().toString(36).substring(2, 8);
    }

    // Check if username is available
    let username = baseUsername;
    let counter = 1;
    let exists = true;

    while (exists) {
      const existingUser = await db('users')
        .where({ username })
        .first();

      if (!existingUser) {
        exists = false;
      } else {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      // Prevent infinite loop
      if (counter > 100) {
        username = `${baseUsername}_${Math.random().toString(36).substring(2, 8)}`;
        exists = false;
      }
    }

    return username;
  }
}

// Export a singleton instance
export const authService = new AuthService();

export default authService;
