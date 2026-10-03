import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * periodDays is the only input a report takes in this first version —
 * see docs/DEV_QA.md's reports section for why: it keeps every report
 * trivially re-runnable (generate the same report again, get a fresh
 * number against today) without a filter-combination matrix to test.
 * Defaults to 30 when omitted; 1-365 covers "today so far" through a
 * full trailing year.
 */
export class GenerateReportDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  periodDays?: number;
}
