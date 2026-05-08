import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Merchant } from '../entities/merchant.entity.js';
import { AgentMerchantAssignment } from '../entities/agent-merchant-assignment.entity.js';
import { MerchantsController } from './merchants.controller.js';
import { MerchantsService } from './merchants.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Merchant, AgentMerchantAssignment])],
  controllers: [MerchantsController],
  providers: [MerchantsService],
})
export class MerchantsModule {}
