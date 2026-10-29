import { Suspense } from "react";
import { CataloguePage } from "../../components/catalogue";
import { Loading } from "../../components/ui";
export default function Page(){return <Suspense fallback={<Loading/>}><CataloguePage/></Suspense>;}
