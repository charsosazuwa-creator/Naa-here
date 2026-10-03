import { Injectable } from '@nestjs/common';

/**
 * This is the reporting Agent's one moderation capability (see
 * db/migrations/026_admin_agent_reports.sql's reporting-agent@naahere.internal).
 *
 * It is read-only and advisory ONLY: every method here looks at a
 * single pending submission and returns a recommendation plus the
 * specific reasons behind it, for a human reviewer to read before
 * they decide. Nothing in this service ever calls decide()/approve/
 * reject on anything, writes to the database, or changes a
 * submission's status — that stays a human's call in the Admin
 * Console, exactly as it was before this existed (see
 * ListingAdminController.decide() and VerificationController's own
 * decide route, neither of which this service touches).
 *
 * Deliberately rule-based rather than a model call: every
 * recommendation here is explainable, deterministic, and reproducible
 * from the same input, with no external dependency and no new cost or
 * configuration for the recommendation to simply work. (The codebase
 * already has a precedent for an optional model-backed assist —
 * marketplace/ai-search.service.ts's natural-language search, which
 * degrades gracefully when ANTHROPIC_API_KEY isn't set — so a richer,
 * model-backed version of this service could follow that same
 * pattern later if the simple rules below turn out not to be enough.)
 */
export interface AgentReview {
  recommendation: 'looks_ready' | 'needs_attention';
  reasons: string[];
}

export interface ListingForReview {
  title: string;
  description: string | null;
  priceType: string;
  priceMinorUnits: number | null;
  contactMethod: string;
  contactValue: string;
  images: { id: string }[];
}

export interface VerificationSubmissionForReview {
  licenseNumber: string | null;
  businessDescription: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

const MIN_DESCRIPTION_LENGTH = 20;
const MIN_TITLE_LENGTH = 3;
const MIN_PHONE_DIGITS = 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ModerationAssistService {
  reviewListing(listing: ListingForReview): AgentReview {
    const reasons: string[] = [];

    if (!listing.description || listing.description.trim().length < MIN_DESCRIPTION_LENGTH) {
      reasons.push(`No description, or a very short one (under ${MIN_DESCRIPTION_LENGTH} characters).`);
    }
    if (listing.images.length === 0) {
      reasons.push('No photos attached.');
    }
    if (listing.title.trim().length < MIN_TITLE_LENGTH) {
      reasons.push('Title is very short.');
    }
    if ((listing.priceType === 'fixed' || listing.priceType === 'starting_from') && !((listing.priceMinorUnits ?? 0) > 0)) {
      reasons.push('Price is zero or missing for a price type that requires one.');
    }
    if (listing.contactMethod === 'email' && !EMAIL_PATTERN.test(listing.contactValue)) {
      reasons.push("Contact email doesn't look like a valid address.");
    }
    if (listing.contactMethod === 'phone' && listing.contactValue.replace(/\D/g, '').length < MIN_PHONE_DIGITS) {
      reasons.push('Contact phone number looks too short to be valid.');
    }

    return { recommendation: reasons.length === 0 ? 'looks_ready' : 'needs_attention', reasons };
  }

  reviewVerificationSubmission(submission: VerificationSubmissionForReview): AgentReview {
    const reasons: string[] = [];

    if (!submission.licenseNumber) {
      reasons.push('No license or registration number provided (self-reported field).');
    }
    if (!submission.businessDescription || submission.businessDescription.trim().length < MIN_DESCRIPTION_LENGTH) {
      reasons.push('Business profile has no description, or a very short one.');
    }
    if (!submission.contactPhone) {
      reasons.push('No business contact phone on file.');
    }
    if (!submission.contactEmail) {
      reasons.push('No business contact email on file.');
    }

    return { recommendation: reasons.length === 0 ? 'looks_ready' : 'needs_attention', reasons };
  }
}
