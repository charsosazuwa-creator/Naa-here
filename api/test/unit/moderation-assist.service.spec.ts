import { ModerationAssistService } from '../../src/modules/moderation-assist/moderation-assist.service';

describe('ModerationAssistService.reviewListing', () => {
  const service = new ModerationAssistService();

  const completeListing = {
    title: 'Professional Haircut & Beard Trim',
    description: 'A full-service haircut and beard trim appointment with a senior barber, 45 minutes.',
    priceType: 'fixed',
    priceMinorUnits: 500000,
    contactMethod: 'phone',
    contactValue: '+2348012345678',
    images: [{ id: 'img-1' }],
  };

  it('recommends looks_ready with no reasons for a complete listing', () => {
    expect(service.reviewListing(completeListing)).toEqual({ recommendation: 'looks_ready', reasons: [] });
  });

  it('flags a missing or very short description', () => {
    const result = service.reviewListing({ ...completeListing, description: 'Too short' });
    expect(result.recommendation).toBe('needs_attention');
    expect(result.reasons).toContain('No description, or a very short one (under 20 characters).');
  });

  it('flags a listing with no photos', () => {
    const result = service.reviewListing({ ...completeListing, images: [] });
    expect(result.reasons).toContain('No photos attached.');
  });

  it('flags a zero or missing price on a price type that requires one', () => {
    const result = service.reviewListing({ ...completeListing, priceMinorUnits: 0 });
    expect(result.reasons).toContain('Price is zero or missing for a price type that requires one.');
  });

  it('does not require a price for negotiable or contact price types', () => {
    const result = service.reviewListing({ ...completeListing, priceType: 'negotiable', priceMinorUnits: null });
    expect(result.reasons).not.toContain('Price is zero or missing for a price type that requires one.');
  });

  it('flags an implausible contact email', () => {
    const result = service.reviewListing({ ...completeListing, contactMethod: 'email', contactValue: 'not-an-email' });
    expect(result.reasons).toContain("Contact email doesn't look like a valid address.");
  });

  it('accepts a plausible contact email', () => {
    const result = service.reviewListing({ ...completeListing, contactMethod: 'email', contactValue: 'owner@example.com' });
    expect(result.reasons).not.toContain("Contact email doesn't look like a valid address.");
  });

  it('flags a too-short contact phone number', () => {
    const result = service.reviewListing({ ...completeListing, contactMethod: 'phone', contactValue: '123' });
    expect(result.reasons).toContain('Contact phone number looks too short to be valid.');
  });

  it('collects every applicable reason at once, not just the first', () => {
    const result = service.reviewListing({
      title: 'x',
      description: null,
      priceType: 'fixed',
      priceMinorUnits: null,
      contactMethod: 'email',
      contactValue: 'nope',
      images: [],
    });
    expect(result.recommendation).toBe('needs_attention');
    expect(result.reasons).toHaveLength(5);
  });
});

describe('ModerationAssistService.reviewVerificationSubmission', () => {
  const service = new ModerationAssistService();

  const completeSubmission = {
    licenseNumber: 'LIC-12345',
    businessDescription: 'A long-established barber shop serving the Lekki area for over five years.',
    contactPhone: '+2348012345678',
    contactEmail: 'business@example.com',
  };

  it('recommends looks_ready with no reasons for a complete submission', () => {
    expect(service.reviewVerificationSubmission(completeSubmission)).toEqual({ recommendation: 'looks_ready', reasons: [] });
  });

  it('flags a missing license number as advisory, not disqualifying on its own', () => {
    const result = service.reviewVerificationSubmission({ ...completeSubmission, licenseNumber: null });
    expect(result.recommendation).toBe('needs_attention');
    expect(result.reasons).toEqual(['No license or registration number provided (self-reported field).']);
  });

  it('flags a missing business description', () => {
    const result = service.reviewVerificationSubmission({ ...completeSubmission, businessDescription: null });
    expect(result.reasons).toContain('Business profile has no description, or a very short one.');
  });

  it('flags missing contact phone and email independently', () => {
    const result = service.reviewVerificationSubmission({ ...completeSubmission, contactPhone: null, contactEmail: null });
    expect(result.reasons).toContain('No business contact phone on file.');
    expect(result.reasons).toContain('No business contact email on file.');
  });
});
