import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @UseGuards(ApiKeyGuard)
  @Post('market-resolved')
  async marketResolved(@Body() payload: any) {
    return this.webhookService.handleMarketResolved(payload);
  }
}
