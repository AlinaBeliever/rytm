// Публічні налаштування підключення до Supabase. Це НЕ секрети:
// anon-ключ безпечно тримати в коді, а доступ до даних захищений правилами RLS
// (кожен користувач бачить лише свої рядки).
export const SUPABASE_URL = 'https://uwqkbeleoegsvcjajhkl.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_-ZYM5g3Kfm0w-_Y9Ys1v3A_-xX6c9ea';

// Публічний ключ Web Push (VAPID). Приватна частина лежить тільки на сервері.
export const VAPID_PUBLIC_KEY = 'BHsG0QzlcpGNc6XOZZcSxMyYHKk-lUrkOVcjCK9zNct9aI1xMRYD92zRcfIcnVifQUCBe95L5J-ZiKNJ8o-9_jc';
