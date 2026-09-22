'use client';
import {RootProvider} from 'fumadocs-ui/provider';
import SearchDialog from '@/components/search';
import type {ReactNode} from 'react';
import {Banner} from "fumadocs-ui/components/banner";
import Link from "next/link";

export function Provider({children}: { children: ReactNode }) {
    return (
        <>
            <Banner variant="rainbow" id="pedro-release">
                <span className="prose">
                    <Link className="link prose" href="/docs/pathing/pedro3">
                        Pedro 3 has been released!
                    </Link>
                </span>
            </Banner>
            <RootProvider theme={{defaultTheme: 'dark'}} search={{SearchDialog}}>{children}</RootProvider>
        </>
    )

}