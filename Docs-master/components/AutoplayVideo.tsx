'use client';
import { useEffect, useRef } from 'react';

export default function AutoplayVideo({ src, type = 'video/mp4' }: { src: string, type?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      const playVideo = async () => {
        try {
          await videoRef.current?.play();
        } catch (error) {
          console.error('Autoplay failed:', error);
        }
      };
      
      playVideo();
      
      // Try again after a short delay (sometimes helps with timing issues)
      setTimeout(playVideo, 1000);
    }
  }, []);

  return (
    <video 
      ref={videoRef}
      width="100%" 
      autoPlay 
      playsInline
      muted 
      loop 
      preload="auto"
    >
      <source src={src} type={type} />
      Your browser does not support the video tag.
    </video>
  );
}