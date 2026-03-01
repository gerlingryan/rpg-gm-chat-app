import { supabase } from '@/lib/supabase'

export default async function Page() {
  const { data, error } = await supabase.from('test').select('*')
  return <pre>{JSON.stringify({ data, error }, null, 2)}</pre>
}
