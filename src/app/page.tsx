import { HeroExperience } from "@/components/hero/HeroExperience";
import { PlantMap } from "@/components/map/PlantMap";
import { FindYourFord } from "@/components/find/FindYourFord";

export default function Home() {
  return (
    <main className="bg-black">
      <HeroExperience />
      <PlantMap />
      <FindYourFord />
    </main>
  );
}
