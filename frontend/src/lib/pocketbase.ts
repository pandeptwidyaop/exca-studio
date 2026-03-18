import PocketBase from 'pocketbase';

const pb = new PocketBase('http://localhost:8092');

// Enable auto cancellation for pending requests
pb.autoCancellation(false);

export default pb;
