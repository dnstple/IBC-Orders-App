import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/pickup'); // Pickup is the default view
}
