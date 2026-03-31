import type { Easing } from "framer-motion";

const easeOut: Easing = "easeOut";

export const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, delay: i * 0.03, ease: easeOut },
  }),
};

export const hoverLift = {
  whileHover: { y: -4, transition: { type: "spring" as const, stiffness: 300, damping: 20 } },
};

export const progressBar = (width: number) => ({
  initial: { width: 0 },
  animate: { width: `${width}%` },
  transition: { duration: 0.8, ease: easeOut },
});

export const fadeInUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: easeOut },
};

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03 },
  },
};

export const tabContent = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.2 },
};

export const oddsFlip = {
  initial: { y: -10, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 10, opacity: 0 },
  transition: { duration: 0.2 },
};
