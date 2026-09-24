import { IsString, MinLength } from 'class-validator';

/** Admin console's "add a business category" action -- see migration 023's 'category.manage' permission. */
export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
