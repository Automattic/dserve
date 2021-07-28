
export class ContainerError extends Error {
    containerName: string;
    constructor(containerName:string, message:string) {
        super(message);
        this.containerName = containerName;
        Error.captureStackTrace(this, ContainerError);
    }
}

export class ImageError extends Error {
    imageName: string;
    constructor(imageName:string, message:string) {
        super(message);
        this.imageName = imageName;
        Error.captureStackTrace(this, ImageError);
    }
}

export class ImageNotFound extends ImageError {
    constructor(name:string) {
        super(name, "Docker image not found");
    }
}

export class InvalidImage extends ImageError {
    constructor(name:string) {
        super(name, "Image is invalid");
    }
}

export class InvalidRegistry extends Error {
    registry: string;
    constructor(registry:string) {
        super("Docker registry is invalid");
        this.registry = registry;
        Error.captureStackTrace(this, InvalidRegistry);
    }
}


