import PocketBase from 'pocketbase';

// Use same origin as the page (works for any host)
const pb = new PocketBase(window.location.origin);

// Enable auto cancellation for pending requests
pb.autoCancellation(false);

export default pb;
