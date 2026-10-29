import { ProfilePage } from "../../../components/community";
export default async function Page({params}:{params:Promise<{handle:string}>}){const {handle}=await params;return <ProfilePage handle={handle}/>;}

export const metadata={robots:{index:false,follow:false}};
