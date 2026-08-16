import { IsInt, Max, Min } from 'class-validator';

export class OnboardingDto {
  /** Number of onboarding steps the owner has completed (0..4). */
  @IsInt()
  @Min(0)
  @Max(4)
  step!: number;
}
