import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service.js';
import { CryptoController } from './crypto.controller.js';

@Global()
@Module({
  controllers: [CryptoController],
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
