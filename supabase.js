import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://fgpbasmdsxvpmkjwlabx.supabase.co"

const supabaseKey = "sb_publishable_xPPj7v2BpHFtHxEAKK-owg_cNZ4oIKa"


export const supabase = createClient(
    supabaseUrl,
    supabaseKey
)