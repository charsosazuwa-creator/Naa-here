/**
 * Help center content for the customer-facing app. Each topic is
 * { id, category, title, summary?, keywords, body }, rendered by
 * web/shared/help-ui.js. `body` is a small hand-written HTML string,
 * same convention as everywhere else in this app.
 *
 * First-pass content drafted from the app's actual screens and
 * routes (see views.* in app.js) -- review and edit freely; nothing
 * here is generated at runtime, it's just a plain array of strings.
 */
const CUSTOMER_HELP_TOPICS = [
  {
    id: 'browse-and-filter',
    category: 'Finding & booking services',
    title: 'Browse and filter services',
    summary: 'Search by category, country and city on the Browse page.',
    keywords: ['search', 'filter', 'category', 'country', 'city', 'discover'],
    body: `
      <p>The <strong>Browse</strong> page lists every published service across all businesses on Naa here. Use the search bar to filter by:</p>
      <ul>
        <li><strong>Search</strong> - matches service or business name</li>
        <li><strong>Category</strong> - Barber and salon, Accommodation, or Artisan and on-demand jobs</li>
        <li><strong>Country</strong> - Nigeria, Kenya, Ghana or South Africa</li>
        <li><strong>City</strong> - a free-text city name, e.g. "Lagos"</li>
      </ul>
      <p>Tap any result to see its full detail page, including price, duration and the business's opening hours.</p>
    `,
  },
  {
    id: 'book-a-service',
    category: 'Finding & booking services',
    title: 'Book a service',
    summary: 'Pick a date and time on a service page to request a booking.',
    keywords: ['book', 'booking', 'schedule', 'appointment', 'reserve'],
    body: `
      <p>Open a service from Browse and use the <strong>Book this service</strong> form on its detail page. You'll pick a date and time; the page shows the business's hours and any already-blocked times so you can avoid picking a slot that's unavailable.</p>
      <p>Booking a service requires being signed in. If you're not signed in yet, you'll be sent to sign in first and brought right back.</p>
      <p>After you book, you can review or cancel it any time from <strong>My bookings</strong>.</p>
    `,
  },
  {
    id: 'custom-job-request',
    category: 'Finding & booking services',
    title: 'Request a custom job',
    summary: "For work that doesn't fit a fixed listing, ask a business directly.",
    keywords: ['job request', 'custom', 'quote', 'artisan'],
    body: `
      <p>Some work (repairs, custom artisan jobs, one-off requests) doesn't fit neatly into a bookable time slot. From a service's detail page, use <strong>Request a custom job</strong> to describe what you need and send it to the business directly.</p>
      <p>Track the status of everything you've sent under <strong>Job requests</strong> in the main navigation.</p>
    `,
  },
  {
    id: 'message-a-business',
    category: 'Messaging & calls',
    title: 'Message a business',
    summary: 'Start a conversation from a service page, or reply from Messages.',
    keywords: ['message', 'chat', 'conversation', 'contact'],
    body: `
      <p>You can message any business at any time - open one of their services and use <strong>Message this business</strong>. There's no eligibility requirement on your side; a business can always be reached by a customer.</p>
      <p>All your conversations, across every business you've messaged, are listed under <strong>Messages</strong> in the main navigation. Replies from the business arrive there too.</p>
    `,
  },
  {
    id: 'call-a-business',
    category: 'Messaging & calls',
    title: 'Call a business',
    summary: 'Start a voice call from a service page; anyone on staff can answer.',
    keywords: ['call', 'voice', 'phone', 'webrtc'],
    body: `
      <p>From a service's detail page, use <strong>Call this business</strong> to start a voice call over the internet (no phone number needed). The call rings every active staff member on that business's team at once - whoever answers first picks it up.</p>
      <p>Calling needs microphone access, which your browser will ask permission for the first time. Your call history, alongside your messages, appears under <strong>Messages</strong>.</p>
      <p><em>Note:</em> calls currently work best on typical home or office networks. If a call won't connect, it may be a restrictive network on one end - try again from a different network if that happens.</p>
    `,
  },
  {
    id: 'manage-bookings',
    category: 'Your account & bookings',
    title: 'View, manage and cancel your bookings',
    summary: 'Everything you’ve booked lives under My bookings.',
    keywords: ['my bookings', 'cancel', 'upcoming', 'past'],
    body: `
      <p><strong>My bookings</strong> lists every booking you've made, across every business. From there you can see a booking's status and cancel it if your plans change.</p>
      <p>If something went wrong with a booking, use <strong>Report a problem</strong> from that same page - see "Report a problem with a booking" in Trust & safety.</p>
    `,
  },
  {
    id: 'report-a-problem',
    category: 'Trust & safety',
    title: 'Report a problem with a booking',
    summary: 'Raise a dispute directly from My bookings if something goes wrong.',
    keywords: ['dispute', 'problem', 'complaint', 'refund', 'issue'],
    body: `
      <p>If a booking didn't go as expected, open <strong>My bookings</strong>, find the booking, and use <strong>Report a problem</strong> to open a dispute. Describe what happened; you can track its progress under <strong>My Disputes</strong> in the main navigation.</p>
      <p>Disputes are reviewed by the platform, separately from the business you booked with, so raising one doesn't require the business's agreement.</p>
    `,
  },
  {
    id: 'marketplace-buying',
    category: 'Marketplace listings & job requests',
    title: 'Buy from the Marketplace',
    summary: 'Browse products, services and inventions posted by other users.',
    keywords: ['marketplace', 'buy', 'product', 'listing'],
    body: `
      <p>The <strong>Marketplace</strong> tab is separate from Browse: it's a listings board where any user - customer or business - can post a product, service or invention for sale, not tied to a bookable time slot. Open a listing to see its price, description and how to contact the seller.</p>
    `,
  },
  {
    id: 'marketplace-selling',
    category: 'Marketplace listings & job requests',
    title: 'Post your own listing',
    summary: 'Anyone can post to the Marketplace, not just registered businesses.',
    keywords: ['sell', 'post', 'my listings', 'create listing'],
    body: `
      <p>Under <strong>My Listings</strong>, you can post your own product, service or invention to the Marketplace - this doesn't require setting up a full business profile. Manage, edit or remove your listings from that same page any time.</p>
    `,
  },
  {
    id: 'accept-invitation',
    category: 'Your account & bookings',
    title: 'Accept a business invitation',
    summary: 'A business may invite you directly by link.',
    keywords: ['invitation', 'invite', 'link'],
    body: `
      <p>A business can send you a direct invitation link (for example, to become a recognized returning customer). Opening that link shows you who invited you and lets you accept or decline it. Once accepted, it may unlock things like the business being able to message you first.</p>
    `,
  },
  {
    id: 'account-and-signin',
    category: 'Your account & bookings',
    title: 'Sign in, sign up and your account',
    summary: 'How your account works, and what stays private.',
    keywords: ['sign in', 'sign up', 'account', 'login', 'password'],
    body: `
      <p>You'll need an account to book, message or call a business. Sign up with your email (you'll get a verification code) or use Google/Facebook sign-in where available. Your session stays active in this browser until you sign out.</p>
      <p>Your account details are only visible to businesses you've actually interacted with (booked, messaged, or been invited by) - not to every business on the platform.</p>
    `,
  },
];
