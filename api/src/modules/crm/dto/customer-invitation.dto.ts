import { IsEmail } from 'class-validator';

/** AC2/AC3: format-validated email address to invite. */
export class InviteCustomerDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email!: string;
}
