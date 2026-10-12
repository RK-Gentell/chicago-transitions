/* The only settings that live in the code. Everything else (people, Chicago emails,
   warehouses, departments...) is on the app's Settings page.
   clientId empty = the app runs in demo mode. */
window.CT_CONFIG = {
  tenantId: '4d6e12e7-4a74-4d57-a23e-6df2030e6f5c',            // Gentell's Microsoft 365 tenant
  clientId: '',                                                 // from IT: "Application (client) ID" of the Chicago Transitions app
  siteUrl: 'https://gentell.sharepoint.com/sites/ChicagoTransitions', // the SharePoint site that holds the lists
  mailbox: 'chicagotransitions@gentell.com',                    // the shared mailbox the flows send from
  appUrl: 'https://rk-gentell.github.io/chicago-transitions/'  // the app's web address (GitHub Pages)
};
if (!window.CT_CONFIG.appUrl) window.CT_CONFIG.appUrl = location.origin + location.pathname;
