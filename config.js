
window.CROCHET_CONFIG = {
    SUPABASE_URL: "https://ebwngkxxfrfiibvwlatg.supabase.co",

    // Your supplied publishable key
    SUPABASE_ANON_KEY: "https://ebwngkxxfrfiibvwlatg.supabase.co/auth/v1/oauth/authorize",

    // Must match the deployed Edge Function name
    FUNCTION_NAME: "products-admin",

    get API_URL() {
        return `${this.SUPABASE_URL}/functions/v1/${this.FUNCTION_NAME}`;
    },

    PAGE_SIZE: 24
};
