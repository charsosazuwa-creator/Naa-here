import { IsEmail, IsIn } from 'class-validator';

/** Milestone 2 supports inviting an existing registered user only; inviting by email to a not-yet-registered person is a later phase. */
export class InviteStaffDto {
  @IsEmail()
  email!: string;

  @IsIn(['staff'])
  roleCode!: 'staff';
}
