import type {IOptions, RecursivePartial} from "@tsparticles/engine";

export default {

    fullScreen: {
        enable: true
    },
    fpsLimit: 120,
    interactivity: {
        detectsOn: "window",
        events: {
            onClick: {
                enable: true,
                mode: "push"
            },
            onHover: {
                enable: true,
                mode: "grab",
                parallax: {
                    enable: true,
                    force: 60,
                    smooth: 10
                }
            }
        }
    },
    particles: {
        color: {value: "#ffffff"},
        links: {
            enable: true,
            color: {value: "#ffffff"},
            distance: 150,
            opacity: 0.4
        },
        move: {
            speed: 2
        },
        number: {
            density: {
                enable: true,
                width: 1920,
                height: 1080
            },
            value: 100
        },
        opacity: {
            value: {min: 0.2, max: 0.3},
            animation: {
                enable: true,
                speed: 1
            }
        },
        size: {
            value: {min: 1, max: 10},
            animation: {
                enable: true,
                speed: 10
            }
        }
    },
    motion: {
        disable: true,
        reduce: {
            factor: 4,
            value: true
        }
    }
} satisfies RecursivePartial<IOptions>;