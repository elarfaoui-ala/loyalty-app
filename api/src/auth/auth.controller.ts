import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import {
  ChangePasswordDto,
  LoginBusinessDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterBusinessDto,
} from './dto/auth.dto';

@ApiTags('business auth')
@Controller('auth/business')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a business' })
  @Post('register')
  register(@Body() dto: RegisterBusinessDto) {
    return this.auth.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Business sign-in' })
  @Post('login')
  login(@Body() dto: LoginBusinessDto) {
    return this.auth.login(dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh the session' })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the password', description: 'Signs out every other session.' })
  @UseGuards(BusinessJwtGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  changePassword(@Req() req: { businessId: string }, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.businessId, dto.currentPassword, dto.newPassword);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
