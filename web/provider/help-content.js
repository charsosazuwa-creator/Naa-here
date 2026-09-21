/**
 * Help center content for the provider-facing app. Same shape and
 * conventions as web/customer/help-content.js. First-pass content
 * drafted from the app's actual tabs (see NAV_ITEMS / views.* in
 * app.js) -- review and edit freely.
 */
const PROVIDER_HELP_TOPICS = [
  {
    id: 'set-up-your-business',
    category: 'Setting up your business',
    title: 'Set up locations, services and availability',
    summary: 'The basics every business needs before customers can book.',
    keywords: ['setup', 'locations', 'services', 'availability', 'hours', 'onboarding'],
    body: `
      <p>Three tabs together make your business bookable:</p>
      <ul>
        <li><strong>Locations</strong> - where you operate, including city and country.</li>
        <li><strong>Services</strong> - what customers can book, with price and duration.</li>
        <li><strong>Availability</strong> - your business hours, which control what time slots customers can pick.</li>
      </ul>
      <p>A service isn't visible to customers on Browse until it's marked published - see "Publish a service" for how that works.</p>
    `,
  },
  {
    id: 'publish-a-service',
    category: 'Setting up your business',
    title: 'Publish a service',
    summary: 'Draft services stay private until you publish them.',
    keywords: ['publish', 'draft', 'visible', 'service'],
    body: `
      <p>New services start as drafts, visible only to you. From the <strong>Services</strong> tab, publish a service once its details are ready - only published services show up on the customer-facing Browse page.</p>
    `,
  },
  {
    id: 'verification',
    category: 'Setting up your business',
    title: 'Get your business verified',
    summary: 'Verification builds customer trust and may unlock features.',
    keywords: ['verification', 'verify', 'trust', 'approval'],
    body: `
      <p>The <strong>Verification</strong> tab walks you through submitting your business for platform review. An administrator checks what you submit and approves or requests changes. You can track the status of your submission from this same tab.</p>
    `,
  },
  {
    id: 'staff',
    category: 'Setting up your business',
    title: 'Manage staff',
    summary: 'Add team members who can help run the business in the app.',
    keywords: ['staff', 'team', 'employees', 'members'],
    body: `
      <p>The <strong>Staff</strong> tab lists who has access to manage this business alongside you. Staff you add can, for example, receive and answer customer calls (a customer calling your business rings every active staff member at once - whoever answers first gets the call).</p>
    `,
  },
  {
    id: 'customers-crm',
    category: 'Working with customers',
    title: 'Your customer list (CRM)',
    summary: 'See everyone who has booked, messaged or been invited.',
    keywords: ['customers', 'crm', 'contacts', 'profile'],
    body: `
      <p>The <strong>Customers</strong> tab is your customer relationship list - everyone who has a booking history, an active conversation, or an accepted invitation with your business. From a customer's row you can message or call them directly, when they have a linked account.</p>
    `,
  },
  {
    id: 'messaging-customers',
    category: 'Working with customers',
    title: 'Message a customer',
    summary: 'You can reply to any customer; starting a new chat requires a relationship.',
    keywords: ['message', 'chat', 'conversation', 'reply'],
    body: `
      <p>You can always reply once a customer has messaged you first. To start a brand-new conversation as the business, the customer needs an existing relationship with you - a booking, a job request, an accepted invitation, or having messaged you before. This keeps customers from being cold-messaged by businesses they've never interacted with.</p>
      <p>All conversations for the business you're currently managing are under <strong>Messages</strong>.</p>
    `,
  },
  {
    id: 'calling-customers',
    category: 'Working with customers',
    title: 'Call a customer',
    summary: 'Same eligibility rule as starting a new message applies to calls.',
    keywords: ['call', 'voice', 'phone', 'webrtc'],
    body: `
      <p>From the <strong>Customers</strong> tab, use <strong>Call</strong> next to a customer's name. The same relationship rule that governs starting a new message applies to calls you initiate - you can always call a customer who's messaged or booked with you before.</p>
      <p>A customer who's blocked your conversation won't be reachable by call either, until they unblock it.</p>
    `,
  },
  {
    id: 'bookings',
    category: 'Managing bookings & jobs',
    title: 'Manage bookings',
    summary: 'See and act on everything customers have booked with you.',
    keywords: ['bookings', 'schedule', 'calendar', 'appointments'],
    body: `
      <p>The <strong>Bookings</strong> tab lists everything customers have booked with your business, based on the availability you've set. Use it to review upcoming appointments and their status.</p>
    `,
  },
  {
    id: 'job-requests',
    category: 'Managing bookings & jobs',
    title: 'Respond to job requests',
    summary: "Custom, non-slot work customers have asked you about.",
    keywords: ['job request', 'custom', 'quote'],
    body: `
      <p>When a customer sends a custom job request (work that doesn't fit a fixed bookable slot), it shows up under <strong>Job requests</strong>. Review the details there and respond to the customer through Messages.</p>
    `,
  },
  {
    id: 'my-listings-provider',
    category: 'Managing bookings & jobs',
    title: 'Post a Marketplace listing',
    summary: 'List a product, service or invention outside your booking calendar.',
    keywords: ['marketplace', 'listing', 'sell', 'product'],
    body: `
      <p><strong>My Listings</strong> lets you post to the Marketplace board - a product, service or invention for sale that isn't tied to a bookable time slot. This is separate from your main Services, and from your customer-facing Browse listing.</p>
    `,
  },
  {
    id: 'groups',
    category: 'Community Groups',
    title: 'Create and manage a group',
    summary: 'Groups bring staff and members together for chat and group calls.',
    keywords: ['groups', 'community', 'members', 'group chat'],
    body: `
      <p>The <strong>Groups</strong> tab lets you create a community group for your business - members can chat together and start group voice calls with each other. Manage who's an active member from a group's detail page.</p>
      <p>Only active members of the same group can call each other through it.</p>
    `,
  },
  {
    id: 'disputes-provider',
    category: 'Trust & safety',
    title: 'Respond to a dispute',
    summary: 'A customer-raised issue with one of your bookings.',
    keywords: ['dispute', 'complaint', 'problem', 'refund'],
    body: `
      <p>If a customer reports a problem with a booking, it appears under <strong>Disputes</strong>. The platform reviews disputes independently, so it's worth responding with your side of what happened as soon as you see one.</p>
    `,
  },
  {
    id: 'payouts',
    category: 'Trust & safety',
    title: 'Payouts',
    summary: 'How and when you receive payment for bookings.',
    keywords: ['payouts', 'payments', 'money', 'earnings'],
    body: `
      <p>The <strong>Payouts</strong> tab shows payments collected for your bookings and their payout status. Naa here is free to use - there's no commission or platform fee taken from what customers pay.</p>
    `,
  },
];
