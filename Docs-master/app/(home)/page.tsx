import {Metadata} from "next";
import PedroSelector from "@/app/(home)/PedroSelector";

export const metadata: Metadata = {
    title: 'Pedro Pathing',
    openGraph: {
        url: 'https://pedropathing.com',
        images: [
            {
                url: 'https://pedropathing.com/banner.png',
                width: 1200,
                height: 686,
            },
        ],
        locale: 'en_US',
        type: 'website',
    }
};

export default function HomePage() {
    return <PedroSelector/>
}