import { HomePage } from "../components/catalogue";
import { libraries } from "../domain/libraries";
import { config } from "../lib/config";
export const dynamic="force-dynamic";
export const metadata={alternates:{canonical:config.appUrl}};
export default async function Page(){const cities=await libraries().catch(()=>({libraries:[]}));return <HomePage initialLibraries={cities.libraries}/>;}
