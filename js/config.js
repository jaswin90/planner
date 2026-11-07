// Public configuration. Nothing in here is secret: an OAuth *client ID*
// is meant to be public; Google only accepts it from the origins you list
// in Google Cloud Console ("Authorized JavaScript origins").
//
// Leave googleClientId empty here. The deploy workflow fills it in from the
// repository secret GOOGLE_CLIENT_ID (see README.md, "Set up Google sign-in"),
// so the ID is never stored in the code. For local testing you may paste it
// in, but do not commit that change.
export const CONFIG = {
  googleClientId: '',
  // Largest single attachment, in megabytes.
  maxAttachmentMB: 20,
};
