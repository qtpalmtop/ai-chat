import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuggestionTemplateEntity } from './entities/suggestion-template.entity';
import { SuggestionService } from './suggestion.service';

@Module({
  imports: [TypeOrmModule.forFeature([SuggestionTemplateEntity])],
  providers: [SuggestionService],
  exports: [SuggestionService],
})
export class SuggestionModule {}
