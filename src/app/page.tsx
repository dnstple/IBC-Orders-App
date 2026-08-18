import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/pickups'); // Pickups is the default view
}
