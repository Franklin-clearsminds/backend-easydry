import { Controller, Post, Body, Get, UseGuards, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión (Web y Móvil)' })
  @ApiResponse({ status: 200, description: 'Sesión iniciada exitosamente con accessToken y refreshToken' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar tokens de sesión con Refresh Token (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Nuevos tokens generados con éxito' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido, expirado o usuario inactivo' })
  async refresh(@Body() refreshDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshDto.refreshToken);
  }

  @Post('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Datos del usuario e información de sucursal' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Post('profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar perfil del usuario autenticado (avatar S3 y datos básicos)' })
  @ApiResponse({ status: 200, description: 'Perfil actualizado' })
  async updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(userId, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar la contraseña propia (solo SUPER_ADMIN y ADMIN)',
    description:
      'Exige la contraseña actual. El resto de roles no puede cambiar su contraseña: se la reinicia un administrador desde Usuarios.',
  })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada' })
  @ApiResponse({ status: 400, description: 'Contraseña actual incorrecta o nueva inválida' })
  @ApiResponse({ status: 403, description: 'El rol no puede cambiar su propia contraseña' })
  async changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    const rol = user?.roleDetails?.namerol || user?.role?.namerol || (typeof user?.role === 'string' ? user.role : '');
    if (!['SUPER_ADMIN', 'ADMIN'].includes(rol)) {
      throw new ForbiddenException(
        'Solo un administrador puede cambiar contraseñas. Solicite a un administrador que reinicie la suya.',
      );
    }
    return this.authService.changePassword(user.id, dto);
  }
}
